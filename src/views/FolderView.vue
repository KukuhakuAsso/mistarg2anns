<script setup>
// 档案查看页：以文件缩略图陈列题目，点击后在可移动窗口中查看详情。
import { computed, onBeforeUnmount, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useClueDrag } from "@/composables/useClueDrag";
import { useGameState } from "@/composables/useGameState";
import puzzleThumbnail from "@/assets/test.jpg";

const props = defineProps({
  folder: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const {
  state,
  setFolderCompleted,
  isClueDiscovered,
  isTipUnlocked,
  unlockTip,
} = useGameState();
const { startDrag: startClueDrag } = useClueDrag();

const puzzles = computed(() =>
  props.folder.entries.filter((entry) => entry.kind === "puzzle"),
);
const clues = computed(() =>
  props.folder.entries.filter((entry) => entry.kind === "clue"),
);
const completed = computed(() =>
  state.completedFolders.includes(props.folder.id),
);
const clueReadCount = computed(
  () => clues.value.filter((entry) => isClueDiscovered(entry.id)).length,
);

const selected = ref(null);
const windowPosition = ref({ x: 0, y: 0 });
const dragOffset = ref(null);
const tipsOpen = ref(false);
const answer = ref("");
const answerStatus = ref("");

const windowStyle = computed(() => ({
  left: `${windowPosition.value.x}px`,
  top: `${windowPosition.value.y}px`,
}));

function openEntry(entry) {
  selected.value = entry;
  tipsOpen.value = false;
  answer.value = "";
  answerStatus.value = "";
  windowPosition.value = {
    x: Math.max(16, Math.round((window.innerWidth - 680) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - 480) / 2)),
  };
}

function startPuzzleDrag(event, entry) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  startClueDrag(event, entry.id, "puzzle");
}

function closeEntry() {
  selected.value = null;
  tipsOpen.value = false;
}

function tipId(index) {
  return `${selected.value.id}-tip-${index + 1}`;
}

function toggleTips() {
  tipsOpen.value = !tipsOpen.value;
}

function unlockSelectedTip(index) {
  unlockTip(tipId(index));
}

function submitAnswer() {
  if (!answer.value.trim()) {
    answerStatus.value = "请输入答案";
    return;
  }

  answerStatus.value = "答案已提交";
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

      <span v-if="completed" class="folder-view__done">
        <AppIcon name="check" :size="14" />
        本档案已完成
      </span>
      <button
        v-else
        class="bar-btn"
        type="button"
        title="完成后解锁下一份档案"
        @click="setFolderCompleted(folder.id)"
      >
        <AppIcon name="check" />
        <span>标记为已完成</span>
      </button>
    </header>

    <section class="file-area" aria-label="题目文件">
      <header class="file-area__head">
        <h2 class="file-area__title">题目文件</h2>
        <span class="file-area__count">{{ puzzles.length }} 项</span>
      </header>

      <ul class="file-grid">
        <li v-for="(entry, index) in puzzles" :key="entry.id">
          <button
            class="puzzle-file"
            type="button"
            :title="`打开题目：${entry.title}`"
            @pointerdown="startPuzzleDrag($event, entry)"
            @click="openEntry(entry)"
          >
            <span class="puzzle-file__thumbnail">
              <img :src="entry.thumbnail || puzzleThumbnail" alt="" />
              <span class="puzzle-file__index" aria-hidden="true">
                {{ String(index + 1).padStart(2, "0") }}
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
        role="dialog"
        :aria-label="selected.title"
        :style="windowStyle"
      >
        <header class="entry-modal__head" @pointerdown="startDrag">
          <div>
            <span class="entry-modal__kind">题目文件</span>
            <div class="entry-modal__title-row">
              <h2 class="entry-modal__title">{{ selected.title }}</h2>
              <div class="tips-control">
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
                    <span>{{ state.tipPoints }} 点</span>
                  </header>
                  <ol class="tips-popover__list">
                    <li
                      v-for="(tip, index) in selected.tips"
                      :key="tipId(index)"
                    >
                      <button
                        class="tips-popover__item"
                        type="button"
                        :disabled="
                          isTipUnlocked(tipId(index)) || state.tipPoints < 1
                        "
                        @click="unlockSelectedTip(index)"
                      >
                        <span>Tips {{ index + 1 }}</span>
                        <span v-if="isTipUnlocked(tipId(index))">{{
                          tip
                        }}</span>
                        <span v-else class="tips-popover__locked">
                          {{ state.tipPoints > 0 ? "1 点解锁" : "点数不足" }}
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

        <p class="entry-modal__body">{{ selected.body }}</p>
        <!-- 
        <section v-if="clues.length" class="clue-list">
          <header class="clue-list__head">
            <h3>相关线索</h3>
            <span>{{ clueReadCount }}/{{ clues.length }}</span>
          </header>
          <ul class="clue-list__items">
            <li v-for="clue in clues" :key="clue.id">
              <button
                class="clue-list__item"
                type="button"
                :disabled="isClueDiscovered(clue.id)"
                @click="discoverClue(clue.id)"
              >
                <AppIcon name="bookmark" :size="15" />
                <span>{{ clue.title }}</span>
                <span class="clue-list__action">
                  {{ isClueDiscovered(clue.id) ? "已加入" : "加入线索栏" }}
                </span>
              </button>
            </li>
          </ul>
        </section> -->

        <form class="answer-form" @submit.prevent="submitAnswer">
          <label class="answer-form__label" for="puzzle-answer">答案</label>
          <div class="answer-form__controls">
            <input
              id="puzzle-answer"
              v-model="answer"
              class="answer-form__input"
              type="text"
              placeholder="输入答案"
              autocomplete="off"
            />
            <button class="bar-btn" type="submit">提交</button>
          </div>
          <p v-if="answerStatus" class="answer-form__status">
            {{ answerStatus }}
          </p>
        </form>
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
  color: var(--accent);
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
  width: min(680px, 100%);
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
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
}

.entry-modal__kind {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

.entry-modal__title {
  font-size: 16px;
}

.entry-modal__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
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

.entry-modal__body {
  min-height: 160px;
  margin: 16px 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-line;
}

.clue-list {
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.clue-list__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text-dim);
}

.clue-list__head h3 {
  font-size: 12px;
  font-weight: 500;
}

.clue-list__head span {
  font-family: var(--mono);
  font-size: 12px;
}

.clue-list__items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.clue-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.clue-list__item:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--surface-alt);
}

.clue-list__item:disabled {
  color: var(--text-dim);
  cursor: default;
}

.clue-list__action {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-dim);
}

.answer-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.answer-form__label {
  font-size: 12px;
  color: var(--text-dim);
}

.answer-form__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.answer-form__input {
  flex: 1;
  min-width: 0;
  padding: 7px 8px;
  border-color: var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  color: var(--text);
  font: inherit;
}

.answer-form__input:focus {
  outline: none;
  border-color: var(--accent);
}

.answer-form__status {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}

@media (max-width: 540px) {
  .folder-view__head {
    flex-wrap: wrap;
  }

  .folder-view__title {
    order: -1;
    flex-basis: 100%;
  }

  .file-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .entry-modal {
    width: calc(100vw - 24px);
    padding: 16px;
  }
}
</style>
