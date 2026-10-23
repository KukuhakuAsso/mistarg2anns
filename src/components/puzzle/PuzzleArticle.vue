<script setup>
// 单题正文：封面 → 题目（H1）→ 描述 → 可塑区 → 附件 → 固定提交区。
// 空字段整块不渲染，不留占位；顺序固定（api-12）。
import { computed, ref, watch } from "vue";
import MalleableArea from "@/components/puzzle/MalleableArea.vue";
import MediaAttachment from "@/components/puzzle/MediaAttachment.vue";
import StatusMessage from "@/components/StatusMessage.vue";
import { puzzleApi } from "@/api/puzzle";
import { extractErrorMessage } from "@/api/errors";
import { renderMarkdown } from "@/utils/miniMarkdown";
import { useMediaObjectUrl } from "@/composables/useMediaObjectUrl";
import { useMarkdownMedia } from "@/composables/useMarkdownMedia";
import { useStatusMessage } from "@/composables/useStatusMessage";

const props = defineProps({
  puzzle: { type: Object, required: true },
});

const emit = defineEmits(["solved"]);

const cover = computed(() => props.puzzle.cover ?? null);
const attachments = computed(() => props.puzzle.attachments ?? []);
const descriptionHtml = computed(() =>
  renderMarkdown(props.puzzle.description || ""),
);

// 描述里的图片（`/api/puzzle/media/:id`）同样受取题门禁保护：
// 渲染器只输出 data-media-path 占位，这里在 DOM 更新后补上带鉴权的 blob URL。
const descriptionRef = ref(null);
useMarkdownMedia(descriptionRef, descriptionHtml);

const coverRatio = computed(() => {
  const ratios = { "16:9": "16 / 9", "4:3": "4 / 3", "1:1": "1 / 1" };
  return ratios[cover.value?.ratio] || "16 / 9";
});

// 封面同样受取题门禁保护，走带鉴权的 blob URL；高度按 ratio 预留，避免加载后跳动。
const { src: coverSrc, status: coverStatus } = useMediaObjectUrl(
  () => cover.value?.url ?? "",
);

const solved = ref(Boolean(props.puzzle.solved));
watch(
  () => props.puzzle,
  (value) => {
    solved.value = Boolean(value?.solved);
  },
);

const answer = ref("");
const submitting = ref(false);
const {
  message: statusMessage,
  tone: statusTone,
  set: setStatus,
  clear: clearStatus,
} = useStatusMessage();

async function submitAnswer() {
  const value = answer.value.trim();
  if (!value) {
    setStatus("error", "请输入答案");
    return;
  }
  if (submitting.value) return;

  submitting.value = true;
  clearStatus();

  try {
    const payload = await puzzleApi.submit({
      puzzleKey: props.puzzle.key,
      answer: value,
    });
    const data = payload?.data ?? {};

    if (data.alreadySolved) {
      solved.value = true;
      setStatus("info", "这道题已经解过了");
      // 队友（或同一账号的另一台设备）已经解出：本组件只能改自己的显示，
      // 档案页的「已解出」勾、顶栏进度、队友解出后新解锁的题目、完成态封面，
      // 都要靠父级重拉 map 才会更新；不通知父级就只能硬刷新页面才能自愈。
      emit("solved", {
        puzzleKey: data.puzzleKey ?? props.puzzle.key,
        progress: data.progress ?? null,
        tips: data.tips ?? null,
      });
    } else if (data.correct) {
      solved.value = true;
      answer.value = "";
      setStatus("success", "答案正确");
      emit("solved", {
        puzzleKey: data.puzzleKey ?? props.puzzle.key,
        progress: data.progress ?? null,
        tips: data.tips ?? null,
      });
    } else {
      setStatus("error", "答案不正确");
    }
  } catch (error) {
    // 404 = 题目不存在 / 尚未解锁（与不存在同形），属正常情况，不提示「加载失败」
    setStatus(
      "error",
      error?.status === 404
        ? "题目不存在或尚未解锁"
        : extractErrorMessage(error, "提交失败，请稍后重试"),
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <article class="puzzle">
    <figure
      v-if="cover"
      class="puzzle__cover"
      :style="{ aspectRatio: coverRatio }"
    >
      <img v-if="coverStatus === 'ready'" :src="coverSrc" :alt="cover.alt" />
      <span v-else-if="coverStatus === 'error'" class="puzzle__cover-fallback">
        封面加载失败
      </span>
    </figure>

    <header class="puzzle__head">
      <h1 class="puzzle__title">{{ puzzle.title }}</h1>
      <span v-if="solved" class="puzzle__badge">已解出</span>
    </header>

    <!-- description 是白名单 Markdown 渲染结果（标签全部由渲染器拼出，不含原始 HTML）；
         其中的受保护图片由 useMarkdownMedia 回填带鉴权的 blob URL -->
    <div
      v-if="descriptionHtml"
      ref="descriptionRef"
      class="puzzle__description"
      v-html="descriptionHtml"
    />

    <MalleableArea
      v-if="puzzle.malleable"
      :malleable="puzzle.malleable"
      class="puzzle__malleable"
    />

    <section v-if="attachments.length" class="puzzle__attachments">
      <h2 class="puzzle__section-title">附件</h2>
      <ul class="attachment-list">
        <MediaAttachment
          v-for="(item, index) in attachments"
          :key="`${item.type}-${item.name}-${index}`"
          :item="item"
        />
      </ul>
    </section>

    <form class="answer-form" @submit.prevent="submitAnswer">
      <label class="answer-form__label" for="puzzle-answer">答案</label>
      <div class="answer-form__controls">
        <input
          id="puzzle-answer"
          v-model="answer"
          class="answer-form__input"
          type="text"
          :placeholder="solved ? '本题已解出' : '输入答案'"
          :disabled="solved || submitting"
          autocomplete="off"
        />
        <button class="bar-btn" type="submit" :disabled="solved || submitting">
          {{ submitting ? "提交中…" : "提交" }}
        </button>
      </div>
      <StatusMessage
        class="answer-form__status"
        :message="statusMessage"
        :tone="statusTone"
      />
    </form>
  </article>
</template>

<style scoped>
.puzzle {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.puzzle__cover {
  margin: 0;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.puzzle__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.puzzle__cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 12px;
  color: var(--text-dim);
}

.puzzle__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.puzzle__title {
  flex: 1;
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
}

.puzzle__badge {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 11px;
  color: var(--accent);
}

.puzzle__description {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
}

.puzzle__description :deep(p:first-child),
.puzzle__description :deep(h2:first-child),
.puzzle__description :deep(ul:first-child) {
  margin-top: 0;
}

.puzzle__description :deep(h2),
.puzzle__description :deep(h3),
.puzzle__description :deep(h4) {
  margin: 18px 0 8px;
  font-size: 15px;
}

.puzzle__description :deep(p) {
  margin: 0 0 10px;
}

.puzzle__description :deep(ul),
.puzzle__description :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}

.puzzle__description :deep(li) {
  margin: 2px 0;
}

.puzzle__description :deep(blockquote) {
  margin: 0 0 10px;
  padding: 6px 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--text-dim);
}

.puzzle__description :deep(code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--border) 45%, transparent);
  font-family: var(--mono);
  font-size: 12px;
}

.puzzle__description :deep(pre) {
  margin: 0 0 10px;
  padding: 10px 12px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg) 70%, var(--surface));
}

.puzzle__description :deep(pre code) {
  padding: 0;
  background: transparent;
}

.puzzle__description :deep(table) {
  width: 100%;
  margin: 0 0 10px;
  border-collapse: collapse;
  font-size: 13px;
}

.puzzle__description :deep(th),
.puzzle__description :deep(td) {
  padding: 5px 8px;
  border: 1px solid var(--border);
  text-align: left;
}

.puzzle__description :deep(hr) {
  margin: 14px 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.puzzle__description :deep(img) {
  max-width: 100%;
  border-radius: var(--radius);
}

/* 受保护图片：加载中先隐藏（此时没有 src，浏览器会画出 alt 文本）；
   失败时保留节点，让 alt 文本作为占位显示，标题里带后端原因。 */
.puzzle__description :deep(img[data-media-state="pending"]) {
  display: none;
}

.puzzle__description :deep(img[data-media-state="error"]) {
  padding: 6px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--text-dim);
}

.puzzle__description :deep(a) {
  color: var(--accent);
}

.puzzle__malleable {
  width: 100%;
}

.puzzle__section-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
}

.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.answer-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.answer-form__label {
  font-size: 12px;
  color: var(--text-dim);
}

.answer-form__controls {
  display: flex;
  gap: 8px;
}

.answer-form__input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-size: 13px;
  color: var(--text);
}

.answer-form__input:focus {
  outline: none;
  border-color: var(--border-strong);
}

.answer-form__status {
  min-height: 16px;
}
</style>
