<script setup>
// 单题正文：封面 → 题目（H1）→ 描述 → 可塑区 → 附件 → 固定提交区。
// 空字段整块不渲染，不留占位；顺序固定（api-12）。
import { computed, ref, watch } from "vue";
import MalleableArea from "@/components/puzzle/MalleableArea.vue";
import MediaAttachment from "@/components/puzzle/MediaAttachment.vue";
import SubmissionHistory from "@/components/puzzle/SubmissionHistory.vue";
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

const coverAspect = computed(() => {
  const ratios = { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1 };
  return ratios[cover.value?.ratio] ?? 16 / 9;
});

// 封面同样受取题门禁保护，走带鉴权的 blob URL；高度按 ratio 预留，避免加载后跳动。
const { src: coverSrc, status: coverStatus } = useMediaObjectUrl(
  () => cover.value?.url ?? "",
);

// 提交历史里的条数：teamProgress 只在取题时下发，本窗口内新提交的记在内存里补上
const historyRef = ref(null);
const extraSubmissions = ref(0);
const historyCount = computed(
  () => Number(props.puzzle.teamProgress?.submissionCount ?? 0) + extraSubmissions.value,
);

const solved = ref(Boolean(props.puzzle.solved));
watch(
  () => props.puzzle,
  (value) => {
    solved.value = Boolean(value?.solved);
    // 父级重取过视图（例如买完提示）后 teamProgress 已含全部提交，本窗口的临时计数要清零
    extraSubmissions.value = 0;
  },
);

const pad2 = (n) => String(n).padStart(2, "0");

function formatStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// 本队该题进度（api-12，迁移 0039 起始终下发）：首次取题 / 首次完成 / 提交次数。
// 只有时间和计数，不含提交内容。旧响应可能没有该字段，按「无进度」处理。
const progressParts = computed(() => {
  const progress = props.puzzle.teamProgress;
  if (!progress) return [];
  const parts = [];
  const firstTaken = formatStamp(progress.firstTakenAt);
  const firstSolved = formatStamp(progress.firstSolvedAt);
  const count = Number(progress.submissionCount);
  if (firstTaken) parts.push(`首次取题 ${firstTaken}`);
  if (firstSolved) parts.push(`首次解出 ${firstSolved}`);
  if (Number.isFinite(count) && count > 0) parts.push(`已提交 ${count} 次`);
  return parts;
});

// duration_ms 只留痕统计：从打开本题开始计时，重新取同一道题（例如买完提示刷新）不重置。
let openedAt = Date.now();
watch(
  () => props.puzzle.key,
  () => {
    openedAt = Date.now();
    // 换题：本窗口累计的提交数归零，交给新题的 teamProgress
    extraSubmissions.value = 0;
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

// 解出（含队友抢先解出）后，父级必须重拉 map：档案页的「已解出」勾、顶栏进度、
// 新解锁的题目与完成态封面都来自 map。本组件只能改自己的显示，不通知父级就只能硬刷新才能自愈。
function notifySolved(data) {
  emit("solved", {
    puzzleKey: data.puzzleKey ?? props.puzzle.key,
    progress: data.progress ?? null,
    tips: data.tips ?? null,
  });
}

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
    // 耗时只留痕统计，后端上限 24 小时
    const durationMs = Math.min(Math.max(Date.now() - openedAt, 0), 86400000);
    const payload = await puzzleApi.submit({
      puzzleKey: props.puzzle.key,
      answer: value,
      durationMs,
    });
    const data = payload?.data ?? {};
    // 每次提交（含答错、含已解后的重复）都会落一条记录
    extraSubmissions.value += 1;
    historyRef.value?.refresh();
    // alreadySolved 只说明「本队此前已解出」，correct 才是本次判题结果：
    // 已解出的队仍可能提交错误答案（后端照样入库），不能一律当成「已解过」。
    const solvedStamp = data.alreadySolved ? formatStamp(data.solvedAt) : "";
    const solvedNote = solvedStamp ? `（首次完成 ${solvedStamp}）` : "";

    if (data.correct) {
      solved.value = true;
      answer.value = "";
      setStatus(
        "success",
        data.alreadySolved ? `答案正确，本题此前已解出${solvedNote}` : "答案正确",
      );
      notifySolved(data);
    } else if (data.alreadySolved) {
      setStatus("error", `答案不正确，但本题此前已解出${solvedNote}`);
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
    <header class="puzzle__head">
      <div class="puzzle__head-main">
        <h1 class="puzzle__title">{{ puzzle.title }}</h1>
        <span v-if="solved" class="puzzle__badge">已解出</span>
      </div>
      <!-- 本队该题进度：只有时间与计数，空值整行不渲染 -->
      <p v-if="progressParts.length" class="puzzle__progress">
        {{ progressParts.join(" · ") }}
      </p>
    </header>

    <!-- 封面放在标题之后：先看到题名，图不抢走首屏。
         高度上限来自父级 --cover-max（内容区高度的 40%），宽度随之收缩，所以不裁切也不留大片空框 -->
    <figure
      v-if="cover"
      class="puzzle__cover"
      :style="{ '--cover-aspect': coverAspect }"
    >
      <img v-if="coverStatus === 'ready'" :src="coverSrc" :alt="cover.alt" />
      <span v-else-if="coverStatus === 'error'" class="puzzle__cover-fallback">
        封面加载失败
      </span>
    </figure>

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

    <SubmissionHistory
      ref="historyRef"
      :puzzle-key="puzzle.key"
      :count="historyCount"
    />
  </article>
</template>

<style scoped>
.puzzle {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.puzzle__cover {
  /* 宽度跟着高度上限收缩：1:1 的封面不会被撑成一条带大片留白的横条 */
  width: min(100%, calc(var(--cover-max, 200px) * var(--cover-aspect, 1.7778)));
  max-height: var(--cover-max, 200px);
  aspect-ratio: var(--cover-aspect, 1.7778);
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.puzzle__cover img {
  display: block;
  width: 100%;
  height: 100%;
  /* 配置的比例与图片实际比例不一致时也不裁切，宁可留白 */
  object-fit: contain;
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
  flex-direction: column;
  gap: 4px;
}

.puzzle__head-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.puzzle__progress {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
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
