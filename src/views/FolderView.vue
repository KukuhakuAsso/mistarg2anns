<script setup>
// 档案（目录）页：题目列表来自 GET /api/puzzle/map，点击后在可移动窗口里取单题视图。
//
// 未解锁的题目根本不会出现在 map 里，所以这里没有锁定态；
// 直接请求未解锁题的 view 会得到 404（与不存在同形），按正常提示处理即可。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import StatusMessage from "@/components/StatusMessage.vue";
import PuzzleArticle from "@/components/puzzle/PuzzleArticle.vue";
import puzzleThumbnail from "@/assets/test.jpg";
import { puzzleApi } from "@/api/puzzle";
import { extractErrorMessage } from "@/api/errors";
import { useGameState } from "@/composables/useGameState";
import { useClueDrag } from "@/composables/useClueDrag";
import { usePuzzleMap } from "@/composables/usePuzzleMap";
import { buildPlaceholderTips } from "@/config/tips";

const props = defineProps({
  folder: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const { refresh } = usePuzzleMap();
const { state, isTipUnlocked, unlockTip, refreshTeamTips, registerBoardCard } =
  useGameState();
const { startDrag: startClueDrag } = useClueDrag();

// 题目内的 Tips 弹层：内容为占位（见 config/tips.js），解锁只记在本地、不扣 tips 余额。
const tipsOpen = ref(false);
const tipsBalance = computed(() => state.teamTips.balance);
const tips = computed(() =>
  buildPlaceholderTips(view.value?.title || selected.value?.title || ""),
);

const puzzles = computed(() =>
  props.folder.entries.filter((entry) => entry.kind === "puzzle"),
);

const selected = ref(null);
const view = ref(null);
const viewStatus = ref("idle"); // idle | loading | ready | error
const viewError = ref("");
const windowPosition = ref({ x: 0, y: 0 });
const dragOffset = ref(null);

const modalWide = computed(() => Boolean(view.value?.malleable?.wide));

const windowStyle = computed(() => ({
  left: `${windowPosition.value.x}px`,
  top: `${windowPosition.value.y}px`,
}));

const modalWidth = computed(() =>
  Math.min(modalWide.value ? 960 : 680, window.innerWidth - 32),
);

async function openEntry(entry) {
  selected.value = entry;
  view.value = null;
  viewError.value = "";
  viewStatus.value = "loading";
  tipsOpen.value = false;
  windowPosition.value = {
    x: Math.max(16, Math.round((window.innerWidth - modalWidth.value) / 3)),
    y: Math.max(16, Math.round((window.innerHeight - 480) / 3)),
  };
  console.log("Opening entry:", entry);
  try {
    const payload = await puzzleApi.getView(entry.id);
    const puzzle = payload?.data?.puzzle ?? null;
    if (!puzzle) throw new Error("题目不存在或尚未解锁");
    view.value = puzzle;
    viewStatus.value = "ready";
  } catch (error) {
    viewStatus.value = "error";
    viewError.value =
      error?.status === 404
        ? "题目不存在或尚未解锁"
        : extractErrorMessage(error, "题目加载失败");
  }
}

function closeEntry() {
  selected.value = null;
  view.value = null;
  viewStatus.value = "idle";
  viewError.value = "";
  tipsOpen.value = false;
}

// 按住题目文件即可拖到右侧线索栏：落点落在板面上会生成一张卡片并持久化。
// 卡片标题/来源来自 map，所以先登记快照再开始拖拽。
function startPuzzleDrag(event, entry) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  registerBoardCard({
    id: entry.id,
    title: entry.title,
    subtitle: props.folder.name,
  });
  startClueDrag(event, entry.id, "puzzle");
}

// 提示的本地解锁键：同一题目同一序号稳定，换题不会串。
function tipId(index) {
  return `${selected.value?.id ?? "puzzle"}-tip-${index + 1}`;
}

function toggleTips() {
  tipsOpen.value = !tipsOpen.value;
}

function unlockSelectedTip(index) {
  unlockTip(tipId(index));
}

// 解出后：当前题立即置为已解出，并重新拉一次 map 让新解锁的题目出现（api-12）。
async function handleSolved({ puzzleKey }) {
  const entry = puzzles.value.find((item) => item.id === puzzleKey);
  if (entry) entry.solved = true;
  if (view.value) view.value.solved = true;
  await refresh();
}

function startDrag(event) {
  if (event.button !== 0 || event.target.closest("button")) return;

  dragOffset.value = {
    x: event.clientX - windowPosition.value.x,
    y: event.clientY - windowPosition.value.y,
  };
  document.addEventListener("pointermove", dragWindow);
  document.addEventListener("pointerup", stopDrag, { once: true });
}

function dragWindow(event) {
  if (!dragOffset.value) return;
  windowPosition.value = {
    x: Math.max(0, event.clientX - dragOffset.value.x),
    y: Math.max(0, event.clientY - dragOffset.value.y),
  };
}

function stopDrag() {
  dragOffset.value = null;
  document.removeEventListener("pointermove", dragWindow);
}

// 进入档案时补刷一次余额：轮询间隔内可能已变化，避免拿旧值判断「点数不足」
onMounted(() => {
  if (state.user.currentUser) {
    refreshTeamTips();
  }
});

onBeforeUnmount(stopDrag);
</script>

<template>
  <section class="folder-view">
    <header class="folder-view__head">
      <button
        class="bar-btn"
        type="button"
        title="返回主界面"
        @click="emit('close')"
      >
        <AppIcon name="back" />
        <span>返回</span>
      </button>

      <div class="folder-view__title">
        <h1 class="folder-view__name">{{ folder.name }}</h1>
        <span class="folder-view__sub">{{ folder.subtitle }}</span>
      </div>

      <span v-if="folder.completed" class="folder-view__done">
        <AppIcon name="check" :size="14" />
        本档案已完成
      </span>
    </header>

    <section class="file-area" aria-label="题目文件">
      <header class="file-area__head">
        <h2 class="file-area__title">题目文件</h2>
        <span class="file-area__count">{{ puzzles.length }} 项</span>
      </header>

      <p v-if="!puzzles.length" class="file-area__empty">
        这里还没有已解锁的题目。
      </p>

      <ul v-else class="file-grid">
        <li v-for="(entry, index) in puzzles" :key="entry.id">
          <button
            class="puzzle-file"
            type="button"
            :title="`打开题目：${entry.title}`"
            @pointerdown="startPuzzleDrag($event, entry)"
            @click="openEntry(entry)"
          >
            <span class="puzzle-file__thumbnail">
              <img :src="puzzleThumbnail" alt="" />
              <span class="puzzle-file__index" aria-hidden="true">
                {{ String(index + 1).padStart(2, "0") }}
              </span>
              <span v-if="entry.solved" class="puzzle-file__solved">
                <AppIcon name="check" :size="11" />
              </span>
            </span>
            <span class="puzzle-file__title">{{ entry.title }}</span>
          </button>
        </li>
      </ul>
    </section>

    <Teleport to="body">
      <article
        v-if="selected"
        class="entry-modal"
        :style="[windowStyle, { width: `${modalWidth}px` }]"
        role="dialog"
        :aria-label="view?.title || selected.title"
      >
        <header class="entry-modal__head" @pointerdown="startDrag">
          <div>
            <span class="entry-modal__kind">题目文件</span>
            <div class="entry-modal__title-row">
              <h2 class="entry-modal__title">
                {{ view?.title || selected.title }}
              </h2>

              <div class="tips-control" @pointerdown.stop>
                <button
                  class="tips-control__button"
                  type="button"
                  :aria-expanded="tipsOpen"
                  @click="toggleTips"
                  @contextmenu.prevent="tipsOpen = true"
                >
                  Tips
                </button>
                <section v-if="tipsOpen" class="tips-popover">
                  <header class="tips-popover__head">
                    <span>提示</span>
                    <span>{{ tipsBalance }} 点</span>
                  </header>
                  <ol class="tips-popover__list">
                    <li v-for="(tip, index) in tips" :key="tipId(index)">
                      <button
                        class="tips-popover__item"
                        type="button"
                        :disabled="
                          isTipUnlocked(tipId(index)) || tipsBalance < 1
                        "
                        @click="unlockSelectedTip(index)"
                      >
                        <span>Tips {{ index + 1 }}</span>
                        <span v-if="isTipUnlocked(tipId(index))">{{ tip }}</span>
                        <span v-else class="tips-popover__locked">
                          {{ tipsBalance > 0 ? "1 点解锁" : "点数不足" }}
                        </span>
                      </button>
                    </li>
                  </ol>
                </section>
              </div>
            </div>
          </div>
          <button
            class="icon-btn"
            type="button"
            title="关闭题目"
            @click="closeEntry"
          >
            <AppIcon name="close" />
          </button>
        </header>

        <div v-if="viewStatus === 'loading'" class="entry-modal__state">
          正在取题…
        </div>

        <div v-else-if="viewStatus === 'error'" class="entry-modal__state">
          <StatusMessage :message="viewError" tone="error" />
        </div>

        <PuzzleArticle v-else-if="view" :puzzle="view" @solved="handleSolved" />
      </article>
    </Teleport>
  </section>
</template>

<style scoped>
.folder-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.folder-view__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.folder-view__title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.folder-view__name {
  font-size: 18px;
}

.folder-view__sub {
  font-size: 13px;
  color: var(--text-dim);
}

.folder-view__done {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--accent);
}

.file-area {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.file-area__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
}

.file-area__title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
}

.file-area__count {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
}

.file-area__empty {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
  gap: 16px;
  width: 100%;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.puzzle-file {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  font-size: 13px;
  color: var(--text);
  text-align: left;
  cursor: grab;
}

.puzzle-file__thumbnail {
  position: relative;
  display: block;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition:
    border-color 0.15s,
    background 0.15s;
}

.puzzle-file:hover .puzzle-file__thumbnail,
.puzzle-file:focus-visible .puzzle-file__thumbnail {
  border-color: var(--border-strong);
  background: var(--accent-soft);
}

.puzzle-file:focus-visible {
  outline: none;
}

.puzzle-file__thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.puzzle-file__index {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 3px 5px;
  border: 1px solid color-mix(in srgb, var(--surface) 80%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
}

.puzzle-file__solved {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  color: var(--accent);
}

.puzzle-file__title {
  width: 100%;
  padding: 0 2px;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-modal {
  position: fixed;
  z-index: 20;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 16px 40px color-mix(in srgb, var(--text) 18%, transparent);
}

.entry-modal__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
}

.entry-modal__head > div {
  flex: 1;
  min-width: 0;
}

.entry-modal__kind {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

.entry-modal__title {
  margin: 2px 0 0;
  font-size: 16px;
  line-height: 1.35;
}

.entry-modal__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tips-control {
  position: relative;
}

.tips-control__button {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-alt);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
}

.tips-control__button:hover,
.tips-control__button[aria-expanded="true"] {
  border-color: var(--border-strong);
  color: var(--accent);
}

.tips-popover {
  position: absolute;
  z-index: 1;
  top: calc(100% + 8px);
  left: 0;
  width: min(320px, calc(100vw - 72px));
  padding: 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--text) 16%, transparent);
}

.tips-popover__head {
  display: flex;
  justify-content: space-between;
  padding: 0 2px 8px;
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

.tips-popover__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.tips-popover__item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.tips-popover__item:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--surface-alt);
}

.tips-popover__item:disabled {
  cursor: default;
}

.tips-popover__locked {
  color: var(--text-dim);
}

.entry-modal__state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  font-size: 13px;
  color: var(--text-dim);
}
</style>
