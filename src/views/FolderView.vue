<script>
// 本次会话内记住用户拖出来的弹窗高度：切题、关窗再开都沿用，刷新页面才回到 2/3。
// 放在模块作用域（不在 setup 里），所以离开档案页再回来也还在。
let rememberedModalHeight = 0;
</script>

<script setup>
// 档案（目录）页：题目列表来自 GET /api/puzzle/map，点击后在可移动窗口里取单题视图。
//
// 未解锁的题目根本不会出现在 map 里，所以这里没有锁定态；
// 直接请求未解锁题的 view 会得到 404（与不存在同形），按正常提示处理即可。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import StatusMessage from "@/components/StatusMessage.vue";
import PuzzleArticle from "@/components/puzzle/PuzzleArticle.vue";
import PuzzleCover from "@/components/puzzle/PuzzleCover.vue";
import { puzzleApi } from "@/api/puzzle";
import { extractErrorMessage } from "@/api/errors";
import {
  failedMediaPaths,
  retryFailedMedia,
} from "@/composables/useMediaObjectUrl";
import { useGameState } from "@/composables/useGameState";
import { useClueDrag } from "@/composables/useClueDrag";
import { usePuzzleMap } from "@/composables/usePuzzleMap";

const props = defineProps({
  folder: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const { refresh } = usePuzzleMap();
const {
  state,
  refreshTeamTips,
  registerBoardCard,
  applyTipsBalance,
} = useGameState();
const { startDrag: startClueDrag } = useClueDrag();

// 题目内的预置提示（api-10 §10.11）：列表随题目视图一起下发，unlocked 已按本队购买记录
// 与 0 价派生；未解锁项没有 content，购买成功后由接口就地返回该条的 unlocked + content。
const tipsOpen = ref(false);
const tipsBalance = computed(() => state.teamTips.balance);
const hints = computed(() => view.value?.hints ?? []);
const tipsError = ref("");
const buyingHintId = ref(null);

const puzzles = computed(() =>
  props.folder.entries.filter((entry) => entry.kind === "puzzle"),
);

// 本档案里加载失败的封面：只有它们才值得显示「重试」入口。
// 用路径集合和失败列表取交集，别的档案 / 线索栏的失败不会让这里亮起来。
const failedCoverPaths = computed(() => {
  const failed = failedMediaPaths.value;
  const hit = new Set();
  for (const entry of puzzles.value) {
    const url = entry.cover?.url;
    if (url && failed.has(url)) hit.add(url);
  }
  return [...hit];
});

const selected = ref(null);
const view = ref(null);
const viewStatus = ref("idle"); // idle | loading | ready | error
const viewError = ref("");
const windowPosition = ref({ x: 0, y: 0 });
const dragOffset = ref(null);
// 弹窗高度：用户可拖动调整，初始值按可用高度的 2/3，离开档案页再回来沿用本会话内的记忆值。
const modalHeight = ref(0);
const resizeOffset = ref(null);

const MODAL_MIN_HEIGHT = 280;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const modalWide = computed(() => Boolean(view.value?.malleable?.wide));

const windowStyle = computed(() => ({
  left: `${windowPosition.value.x}px`,
  top: `${windowPosition.value.y}px`,
}));

const modalWidth = computed(() =>
  Math.min(modalWide.value ? 960 : 680, window.innerWidth - 32),
);

// 实际宽度要等 view 回来才确定，但位置必须一开始就定好：若先按窄版定位，
// 宽版展开后右边缘会顶出视口。所以定位统一按最宽形态计算。
const modalPositionWidth = computed(() =>
  Math.min(960, window.innerWidth - 32),
);

// 弹窗顶部以下还能用多高。高度一律夹在这个范围内 —— 否则底边会跑出视口，
// 内容区滚到底也够不到最下面的答题框。
function availableHeight() {
  return Math.max(0, window.innerHeight - windowPosition.value.y - 16);
}

// 高度范围。视口极小时可用空间可能比最小高度还小，这时以可用空间为准，别硬撑出视口。
function heightBounds() {
  const available = availableHeight();
  return { min: Math.min(MODAL_MIN_HEIGHT, available), max: available };
}

// 初始高度：可用高度的 2/3。用户拖过就沿用它（同一会话内不再重置）。
function fitModalHeight() {
  const { min, max } = heightBounds();
  const base = rememberedModalHeight > 0
    ? rememberedModalHeight
    : Math.round(max * (2 / 3));
  return clamp(base, min, max);
}

// 取题请求的代次：关闭弹窗或改开别的题后，旧请求的响应必须作废，
// 否则加载慢的那道题迟到的响应会把用户正在看的题整个换掉。
let viewToken = 0;

async function openEntry(entry) {
  const token = ++viewToken;
  selected.value = entry;
  view.value = null;
  viewError.value = "";
  viewStatus.value = "loading";
  tipsOpen.value = false;
  tipsError.value = "";
  buyingHintId.value = null;
  windowPosition.value = {
    x: Math.max(
      16,
      Math.round((window.innerWidth - modalPositionWidth.value) / 3),
    ),
    y: Math.max(16, Math.round((window.innerHeight - 480) / 3)),
  };
  // 位置定了才能算可用高度
  modalHeight.value = fitModalHeight();
  try {
    const payload = await puzzleApi.getView(entry.id);
    if (token !== viewToken) return;
    const puzzle = payload?.data?.puzzle ?? null;
    if (!puzzle) throw new Error("题目不存在或尚未解锁");
    view.value = puzzle;
    viewStatus.value = "ready";
  } catch (error) {
    if (token !== viewToken) return;
    viewStatus.value = "error";
    viewError.value =
      error?.status === 404
        ? "题目不存在或尚未解锁"
        : extractErrorMessage(error, "题目加载失败");
  }
}

function closeEntry() {
  viewToken += 1;
  selected.value = null;
  view.value = null;
  viewStatus.value = "idle";
  viewError.value = "";
  tipsOpen.value = false;
}

// 按住题目文件即可拖到右侧线索栏：落点落在板面上会生成一张卡片并持久化。
// 元数据随拖拽一起带过去，由 useClueDrag 在「真的落板成功」时才登记收藏 ——
// 在这里登记的话，普通点击读题、拖到一半取消都会把题目永久塞进待用区。
function startPuzzleDrag(event, entry) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  startClueDrag(event, entry.id, "puzzle", {
    id: entry.id,
    title: entry.title,
    subtitle: props.folder.name,
    cover: entry.cover,
  });
}

function toggleTips() {
  tipsOpen.value = !tipsOpen.value;
  tipsError.value = "";
}

// 提示被出题人改过（404 / 已购正文更新）时静默重取一次视图，不重置弹窗位置。
async function reloadView(token) {
  const key = view.value?.key;
  if (!key) return;
  try {
    const payload = await puzzleApi.getView(key);
    if (token !== viewToken) return;
    const puzzle = payload?.data?.puzzle ?? null;
    if (puzzle) view.value = puzzle;
  } catch {
    // 重取失败保持当前内容：错误文案已经给过一次了
  }
}

// 就地替换一条提示：别整棵 view 换掉，否则正文里的可塑区会跟着重建。
function replaceHint(next) {
  const list = view.value?.hints;
  if (!Array.isArray(list) || !next) return;
  const target = list.find((item) => item.id === next.id);
  if (target) Object.assign(target, next);
}

// 购买一条预置提示：一步买断、队伍共享、不可退款（api-10 §10.11）。
async function buyHint(hint) {
  const puzzle = view.value;
  if (!puzzle || buyingHintId.value !== null) return;

  const cost = Number(hint?.cost) || 0;
  const confirmText =
    cost > 0
      ? `花费 ${cost} 点，购买后全队可见，确定购买吗？`
      : `「${hint?.name || "该提示"}」是免费提示，确定解锁吗？`;
  if (!window.confirm(confirmText)) return;

  const token = viewToken;
  buyingHintId.value = hint.id;
  tipsError.value = "";
  try {
    const payload = await puzzleApi.buyHint(puzzle.key, hint.id);
    if (token !== viewToken) return;
    const data = payload?.data ?? {};
    replaceHint(data.hint);
    applyTipsBalance(data.balance);
  } catch (error) {
    if (token !== viewToken) return;
    if (error?.code === "E_TIPS_SHORT") {
      // 余额不足：服务端整体回滚（不扣费、不落购买记录），补点数后重新购买即可
      const detail = error.payload?.error?.detail ?? {};
      const balance = Number(detail.balance);
      const required = Number(detail.required);
      tipsError.value =
        Number.isFinite(balance) && Number.isFinite(required)
          ? `点数不足（当前 ${balance} / 需要 ${required}）`
          : "点数不足，请先让队伍补充提示点";
      if (Number.isFinite(balance)) applyTipsBalance(balance);
    } else if (error?.status === 404) {
      // 提示被删掉 / 不属于本题：以服务端为准重取视图
      tipsError.value = "提示已变更，已重新获取题目";
      await reloadView(token);
    } else {
      tipsError.value = extractErrorMessage(error, "购买失败，请稍后重试");
    }
  } finally {
    if (token === viewToken) buyingHintId.value = null;
  }
}

// 解出后：当前题立即置为已解出，并重新拉一次 map 让新解锁的题目出现（api-12）。
async function handleSolved({ puzzleKey }) {
  const entry = puzzles.value.find((item) => item.id === puzzleKey);
  if (entry) entry.solved = true;
  if (view.value) view.value.solved = true;
  await refresh();
  // 重新拉 map 后封面可能换成完成态；板面快照存的是旧封面，跟着更新一次。
  // 只更新「已经收藏过」的卡片：解出一道从没拖进板面的题，不该把它塞进待用区。
  const fresh = puzzles.value.find((item) => item.id === puzzleKey);
  if (fresh) {
    registerBoardCard(
      {
        id: fresh.id,
        title: fresh.title,
        subtitle: props.folder.name,
        cover: fresh.cover,
      },
      { createIfMissing: false },
    );
  }
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
  const nextX = Math.max(0, event.clientX - dragOffset.value.x);
  const nextY = Math.max(0, event.clientY - dragOffset.value.y);
  windowPosition.value = {
    // 高度是固定的，拖到视口外底边就会溢出（内容区滚到底也够不到答题框），所以夹住
    x: Math.min(nextX, Math.max(0, window.innerWidth - modalWidth.value - 8)),
    y: Math.min(nextY, Math.max(0, window.innerHeight - modalHeight.value - 8)),
  };
}

function stopDrag() {
  dragOffset.value = null;
  document.removeEventListener("pointermove", dragWindow);
}

// 右下角把手：只改高度，夹在 [最小高度, 顶部以下可用空间] 内
function startResize(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  resizeOffset.value = { y: event.clientY, height: modalHeight.value };
  document.addEventListener("pointermove", resizeWindow);
  document.addEventListener("pointerup", stopResize, { once: true });
  document.addEventListener("pointercancel", stopResize, { once: true });
}

function resizeWindow(event) {
  if (!resizeOffset.value) return;
  const { min, max } = heightBounds();
  const next =
    resizeOffset.value.height + (event.clientY - resizeOffset.value.y);
  modalHeight.value = clamp(next, min, max);
}

function stopResize() {
  if (resizeOffset.value) rememberedModalHeight = modalHeight.value;
  resizeOffset.value = null;
  document.removeEventListener("pointermove", resizeWindow);
  document.removeEventListener("pointercancel", stopResize);
}

// 键盘也能调（把手可获得焦点）
function nudgeHeight(event) {
  const step = event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
  if (!step) return;
  event.preventDefault();
  const { min, max } = heightBounds();
  modalHeight.value = clamp(modalHeight.value + step, min, max);
  rememberedModalHeight = modalHeight.value;
}

// 视口变化（窗口缩放 / 转屏）：位置与高度都夹回可用范围。
// 高度以「用户选过的值」为基准重新夹取，这样窗口缩小再放大能回到原高度，
// 而不是停在被压缩后的最小值。
function handleViewportResize() {
  if (!selected.value) return;
  windowPosition.value = {
    x: clamp(windowPosition.value.x, 0, Math.max(0, window.innerWidth - modalWidth.value - 8)),
    y: clamp(windowPosition.value.y, 0, Math.max(0, window.innerHeight - MODAL_MIN_HEIGHT - 8)),
  };
  const { min, max } = heightBounds();
  const target = rememberedModalHeight > 0 ? rememberedModalHeight : modalHeight.value;
  modalHeight.value = clamp(target, min, max);
}

// 进入档案时补刷一次余额：轮询间隔内可能已变化，避免拿旧值判断「点数不足」
onMounted(() => {
  if (state.user.currentUser) {
    refreshTeamTips();
  }
  window.addEventListener("resize", handleViewportResize);
});

onBeforeUnmount(() => {
  stopDrag();
  stopResize();
  window.removeEventListener("resize", handleViewportResize);
});
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

      <!-- 封面加载失败时才出现：一次把这批封面重新取一遍（不会重新下载已成功的） -->
      <button
        v-if="failedCoverPaths.length"
        class="bar-btn folder-view__retry"
        type="button"
        :title="`重新加载 ${failedCoverPaths.length} 张封面`"
        @click="retryFailedMedia(failedCoverPaths)"
      >
        <AppIcon name="reset" />
        <span>重试封面 {{ failedCoverPaths.length }}</span>
      </button>
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
              <PuzzleCover :cover="entry.cover" />
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
        :style="[
          windowStyle,
          { width: `${modalWidth}px`, height: modalHeight ? `${modalHeight}px` : undefined },
        ]"
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

              <div v-if="view" class="tips-control" @pointerdown.stop>
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
                  <p v-if="tipsError" class="tips-popover__error">
                    {{ tipsError }}
                  </p>
                  <p v-if="!hints.length" class="tips-popover__empty">
                    本题没有预置提示
                  </p>
                  <ol v-else class="tips-popover__list">
                    <li v-for="hint in hints" :key="hint.id">
                      <div class="tips-popover__item">
                        <span class="tips-popover__name">{{ hint.name }}</span>
                        <!-- 已解锁：纯文本渲染，保留出题人写的换行 -->
                        <p
                          v-if="hint.unlocked"
                          class="tips-popover__content"
                        >
                          {{ hint.content }}
                        </p>
                        <div v-else class="tips-popover__buy-row">
                          <span class="tips-popover__locked">
                            全队可见 · 不可退款
                          </span>
                          <button
                            class="tips-popover__buy"
                            type="button"
                            :disabled="buyingHintId !== null"
                            @click="buyHint(hint)"
                          >
                            {{
                              buyingHintId === hint.id
                                ? "购买中…"
                                : hint.cost > 0
                                  ? `${hint.cost} 点购买`
                                  : "免费解锁"
                            }}
                          </button>
                        </div>
                      </div>
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

        <div class="entry-modal__body">
          <div v-if="viewStatus === 'loading'" class="entry-modal__state">
            正在取题…
          </div>

          <div v-else-if="viewStatus === 'error'" class="entry-modal__state">
            <StatusMessage :message="viewError" tone="error" />
          </div>

          <PuzzleArticle
            v-else-if="view"
            :puzzle="view"
            @solved="handleSolved"
          />
        </div>

        <span
          class="entry-modal__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动或按上下方向键调整题目窗口高度"
          tabindex="0"
          @pointerdown="startResize"
          @keydown="nudgeHeight"
        />
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

/* 重试入口跟「已完成」徽章同排，只在有失败封面时出现 */
.folder-view__retry {
  flex: none;
  color: var(--text);
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
  /* 高度由脚本计算（初始 = 可用高度 2/3，可拖拽调整），这里不设 max-height，
     免得与计算值打架、把底边又裁回视口外 */
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 32px);
  /* 兜底：脚本算出的高度总在视口内，这里防的是将来改动漏夹 */
  max-height: calc(100vh - 16px);
  /* 提示弹层要从窗口里溢出来，所以不能裁内容 */
  overflow: visible;
  /* 滚动交给 body：窗口高度固定，header 自然固定在顶部，把手也不会被滚走 */
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 16px 40px color-mix(in srgb, var(--text) 18%, transparent);
}

/* 题目头部固定在窗口顶端：翻页时标题 / Tips / 关闭按钮始终可见 */
.entry-modal__head {
  position: relative;
  z-index: 2;
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 20px 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  cursor: grab;
  user-select: none;
}

.entry-modal__body {
  flex: 1;
  /* 关键：min-height:0 才允许 flex 子项收缩，否则不出现滚动条而是撑破窗口 */
  min-height: 0;
  overflow-y: auto;
  padding: 0 20px 20px;
}

/* 右下角高度把手 */
.entry-modal__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  border-bottom-right-radius: var(--radius);
  cursor: ns-resize;
  touch-action: none;
}

.entry-modal__resize::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 9px;
  height: 9px;
  background-image: repeating-linear-gradient(
    135deg,
    var(--text-dim) 0 1px,
    transparent 1px 3px
  );
  opacity: 0.65;
}

.entry-modal__resize:hover::after,
.entry-modal__resize:focus-visible::after {
  background-image: repeating-linear-gradient(
    135deg,
    var(--accent) 0 1px,
    transparent 1px 3px
  );
  opacity: 1;
}

.entry-modal__resize:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
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
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - 72px));
  max-height: min(420px, calc(100vh - 140px));
  padding: 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--text) 16%, transparent);
}

.tips-popover__head {
  display: flex;
  flex: none;
  justify-content: space-between;
  padding: 0 2px 8px;
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

.tips-popover__error {
  flex: none;
  margin-top: 8px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  font-size: 12px;
  color: var(--danger);
}

.tips-popover__empty {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.tips-popover__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.tips-popover__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-alt);
  font-size: 12px;
}

.tips-popover__name {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
}

/* 正文是出题人写的纯文本：保留换行，不按 Markdown 解析 */
.tips-popover__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  color: var(--text);
}

.tips-popover__buy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tips-popover__locked {
  color: var(--text-dim);
  font-size: 11px;
}

.tips-popover__buy {
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.tips-popover__buy:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.tips-popover__buy:disabled {
  cursor: default;
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
