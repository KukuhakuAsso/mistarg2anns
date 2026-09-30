<script setup>
// 档案查看页：以文件缩略图陈列题目，点击后在可移动窗口中查看详情。
import { computed, onBeforeUnmount, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useGameState } from "@/composables/useGameState";
import puzzleThumbnail from "@/assets/test.jpg";

const props = defineProps({
  folder: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const { state, setFolderCompleted, discoverClue, isClueDiscovered } =
  useGameState();

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

const windowStyle = computed(() => ({
  left: `${windowPosition.value.x}px`,
  top: `${windowPosition.value.y}px`,
}));

function openEntry(entry) {
  selected.value = entry;
  windowPosition.value = {
    x: Math.max(16, Math.round((window.innerWidth - 680) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - 480) / 2)),
  };
}

function closeEntry() {
  selected.value = null;
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
            @click="openEntry(entry)"
          >
            <span class="puzzle-file__thumbnail">
              <img :src="puzzleThumbnail" alt="" />
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
            <h2 class="entry-modal__title">{{ selected.title }}</h2>
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
        </section>
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
  cursor: pointer;
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
  margin-top: 2px;
  font-size: 16px;
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
