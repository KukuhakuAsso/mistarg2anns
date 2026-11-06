<script setup>
// 本队该题的提交历史（api-12 § 提交历史）。
//   * 服务端强制 team_id，只返回本队数据，不接受队伍参数；
//   * 含答错与「已解出后的重复提交」；
//   * 游标分页：id 倒序（最新在前），nextCursor 传回即可取下一页。
// 默认折叠、展开时才请求：题目窗口已经很长，不该为一个次要区块多等一次请求。
import { computed, ref, watch } from "vue";
import { puzzleApi } from "@/api/puzzle";
import { extractErrorMessage } from "@/api/errors";
import {
  normalizeSubmissionPage,
  toSubmissionRow,
} from "@/utils/submissionPage";

const props = defineProps({
  puzzleKey: { type: String, required: true },
  // 来自 teamProgress.submissionCount：只用于折叠时的条数提示，不参与分页
  count: { type: Number, default: 0 },
});

const PAGE_SIZE = 20;

const open = ref(false);
const items = ref([]);
const loading = ref(false);
const loadingMore = ref(false);
const loaded = ref(false);
const error = ref("");
const nextCursor = ref(null);
const hasMore = ref(false);

// 切题后旧请求的响应必须作废，否则会把上一题的记录填进当前题
let token = 0;

const label = computed(() => {
  const total = Math.max(props.count, items.value.length);
  return total > 0 ? `本队提交记录（${total}）` : "本队提交记录";
});

const pad2 = (n) => String(n).padStart(2, "0");

function formatStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatDuration(ms) {
  if (typeof ms !== "number" || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

async function load({ reset = false } = {}) {
  // 先判守卫再动 token：过早自增会让在飞请求的结果被丢弃，且它的 finally 不再收尾，
  // loading 会永久卡住
  if (!reset && (loading.value || loadingMore.value)) return;

  const current = ++token;
  if (reset) {
    loading.value = true;
    error.value = "";
  } else {
    loadingMore.value = true;
  }

  try {
    // 玩家端 request() 返回的是整个响应体（{ ok, data, req_id }），
    // 与管理端 http.js 直接返回 data 不同 —— 归一化统一在 utils 里做，避免再取错层级
    const payload = await puzzleApi.getSubmissions(props.puzzleKey, {
      cursor: reset ? 0 : nextCursor.value ?? 0,
      limit: PAGE_SIZE,
    });
    if (current !== token) return;

    const page = normalizeSubmissionPage(payload);
    const list = page.items.map(toSubmissionRow);
    items.value = reset ? list : [...items.value, ...list];
    nextCursor.value = page.nextCursor;
    hasMore.value = page.hasMore;
    loaded.value = true;
  } catch (err) {
    if (current !== token) return;
    error.value =
      err?.status === 404
        ? "题目不存在或尚未解锁"
        : extractErrorMessage(err, "提交记录加载失败");
  } finally {
    if (current === token) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function toggle() {
  open.value = !open.value;
}

// 展开且还没加载过才请求；再次展开直接用已有列表（手动刷新见 refresh）
watch(open, (isOpen) => {
  if (isOpen && !loaded.value && !loading.value) load({ reset: true });
});

// 换题：清空并折叠，避免把上一题的记录留在新题里
watch(
  () => props.puzzleKey,
  () => {
    token += 1;
    open.value = false;
    items.value = [];
    loaded.value = false;
    error.value = "";
    nextCursor.value = null;
    hasMore.value = false;
    loading.value = false;
    loadingMore.value = false;
  },
);

// 提交过答案后调用：已展开则静默重取第一页，折叠状态只让下次展开重新拉
async function refresh() {
  if (!open.value) {
    loaded.value = false;
    return;
  }
  await load({ reset: true });
}

defineExpose({ refresh });
</script>

<template>
  <section class="history">
    <button class="history__toggle" type="button" @click="toggle">
      <span class="history__caret" :class="{ 'is-open': open }">▸</span>
      <span>{{ label }}</span>
      <span class="history__hint">队伍内可见</span>
    </button>

    <div v-if="open" class="history__body">
      <p v-if="loading" class="history__state">正在读取…</p>
      <p v-else-if="error" class="history__state history__state--error">
        {{ error }}
        <button class="history__retry" type="button" @click="load({ reset: true })">
          重试
        </button>
      </p>
      <p v-else-if="!items.length" class="history__state">还没有提交记录</p>

      <template v-else>
        <ol class="history__list">
          <li v-for="item in items" :key="item.id" class="history__item">
            <div class="history__row">
              <span
                class="history__verdict"
                :class="item.correct ? 'is-correct' : 'is-wrong'"
              >
                {{ item.correct ? "正确" : "错误" }}
              </span>
              <code class="history__answer">{{ item.answer }}</code>
            </div>
            <div class="history__meta">
              <span>{{ item.username || `账号 #${item.accountId}` }}</span>
              <span>·</span>
              <span>{{ formatStamp(item.createdAt) }}</span>
              <template v-if="formatDuration(item.durationMs)">
                <span>·</span>
                <span>用时 {{ formatDuration(item.durationMs) }}</span>
              </template>
            </div>
          </li>
        </ol>

        <button
          v-if="hasMore"
          class="history__more"
          type="button"
          :disabled="loadingMore"
          @click="load()"
        >
          {{ loadingMore ? "加载中…" : "加载更早的提交" }}
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.history {
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.history__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font-size: 12px;
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
}

.history__toggle:hover {
  color: var(--text);
}

.history__caret {
  display: inline-block;
  transition: transform 0.15s ease;
}

.history__caret.is-open {
  transform: rotate(90deg);
}

.history__hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dim);
  opacity: 0.7;
}

.history__body {
  margin-top: 10px;
}

.history__state {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}

.history__state--error {
  color: #d9534f;
}

.history__retry {
  margin-left: 8px;
  padding: 0;
  border: 0;
  background: none;
  font-size: 12px;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}

.history__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history__item {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg) 70%, var(--surface));
}

.history__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.history__verdict {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.5;
}

.history__verdict.is-correct {
  background: var(--accent-soft);
  color: var(--accent);
}

.history__verdict.is-wrong {
  background: color-mix(in srgb, #d9534f 14%, transparent);
  color: #d9534f;
}

.history__answer {
  min-width: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  overflow-wrap: anywhere;
}

.history__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.history__more {
  width: 100%;
  margin-top: 10px;
  padding: 6px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: none;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}

.history__more:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
