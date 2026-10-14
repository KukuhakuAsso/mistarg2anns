<script setup>
// 站内信中心：对接 /api/msg/*。
// 会话分三类：system（官方公告，只读）、account（账号级会话，问题反馈）、team（队伍会话）。
// 注意：system 与 account 的 teamName 都是 null，必须用 kind 区分，不能只看 teamName。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useGameState } from "@/composables/useGameState";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { extractErrorMessage } from "@/api/errors";
import StatusMessage from "@/components/StatusMessage.vue";
import { messageApi } from "@/api/message";
import { tipsApi } from "@/api/tips";
import UserTabs from "@/components/UserTabs.vue";

const { state, refreshUnreadSummary } = useGameState();

// 会话列表与当前会话内容
const threads = ref([]);
const threadsLoading = ref(false);
const activeThreadId = ref(null);
const messages = ref([]);
const messagesLoading = ref(false);
const lastId = ref(0);

// 发送与提示；操作结果提示的文案与语义色统一交给 useStatusMessage 管理。
const draft = ref("");
const sending = ref(false);
const {
  message: notice,
  tone: noticeType,
  set: setNotice,
} = useStatusMessage();

// 问题反馈（任何登录用户可用，不要求有队伍）
const feedbackOpen = ref(false);
const feedbackDraft = ref("");
const feedbackSubmitting = ref(false);

// 人工求提示：服务端不去重，必须防连点
const hintSubmitting = ref(false);
const hintCost = ref(1);
const tipsBalance = ref(0);
const tipsHasTeam = ref(false);

// 提示请求历史
const hintHistoryOpen = ref(false);
const hintRequests = ref([]);
const hintRequestsLoading = ref(false);
const hintNextCursor = ref(null);

const THREAD_POLL_MS = 10000;
let threadTimer = null;

const isLoggedIn = computed(() => Boolean(state.user.currentUser));
const activeThread = computed(
  () =>
    threads.value.find((item) => item.threadId === activeThreadId.value) ??
    null,
);
// 官方公告为只读，不显示输入框。
const isReadOnly = computed(() => activeThread.value?.kind === "system");
// 仅队伍会话支持求人工提示。
const canRequestHint = computed(() => activeThread.value?.kind === "team");

// 错误文案统一由 @/api/errors 解析（含字段级原因），本地保留短名便于调用。
const errorText = extractErrorMessage;

// 会话显示名：system / account 的 teamName 均为 null，靠 kind 区分。
function threadName(thread) {
  if (!thread) {
    return "";
  }
  if (thread.kind === "system") {
    return "官方公告";
  }
  if (thread.kind === "account") {
    return "问题反馈";
  }
  return thread.teamName || "队伍会话";
}

function threadKindLabel(kind) {
  if (kind === "system") {
    return "公告";
  }
  if (kind === "account") {
    return "反馈";
  }
  return "队伍";
}

// 消息署名：to_staff 表示自己发送，to_player 表示官方或工作人员（统一匿名）。
function senderName(message) {
  return message.direction === "to_staff" ? "我" : "官方 / 工作人员";
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------- 会话列表 ----------

async function loadThreads() {
  if (!isLoggedIn.value) {
    return;
  }

  threadsLoading.value = true;
  try {
    const response = await messageApi.getThreads();
    threads.value = response?.data?.threads ?? [];

    // 当前会话已不可见（例如退队后队伍会话消失）时清空详情。
    if (!threads.value.some((item) => item.threadId === activeThreadId.value)) {
      activeThreadId.value = null;
      messages.value = [];
      lastId.value = 0;
    }
  } catch (error) {
    setNotice("error", errorText(error, "加载会话列表失败。"));
  } finally {
    threadsLoading.value = false;
  }
}

// ---------- 会话内容 ----------

async function openThread(thread) {
  activeThreadId.value = thread.threadId;
  messages.value = [];
  lastId.value = 0;
  notice.value = "";
  await fetchThreadMessages({ reset: true });
  await markActiveRead();
  startThreadPolling();
}

// reset=true 从头拉取；否则按 since_id 增量拉取并追加。
async function fetchThreadMessages({ reset = false } = {}) {
  const threadId = activeThreadId.value;
  if (!threadId) {
    return;
  }

  messagesLoading.value = true;
  try {
    const response = await messageApi.getThreadMessages(threadId, {
      sinceId: reset ? 0 : lastId.value,
      limit: 50,
    });
    const data = response?.data ?? {};
    const incoming = Array.isArray(data.messages) ? data.messages : [];

    if (reset) {
      messages.value = incoming;
    } else if (incoming.length) {
      messages.value = [...messages.value, ...incoming];
    }

    const nextLastId = Number(data.lastId);
    if (Number.isFinite(nextLastId) && nextLastId > lastId.value) {
      lastId.value = nextLastId;
    }
  } catch (error) {
    setNotice("error", errorText(error, "加载会话内容失败。"));
  } finally {
    messagesLoading.value = false;
  }
}

// 轮询增量拉取并推进已读位置。
async function pollThreadMessages() {
  if (!activeThreadId.value) {
    return;
  }

  await fetchThreadMessages({ reset: false });
  await markActiveRead({ silent: true });
}

// 更新已读位置；lastId 为 0（无消息）时跳过。
async function markActiveRead({ silent = false } = {}) {
  const threadId = activeThreadId.value;
  if (!threadId || lastId.value <= 0) {
    return;
  }

  try {
    await messageApi.markRead(threadId, lastId.value);
    const target = threads.value.find((item) => item.threadId === threadId);
    if (target) {
      target.unread = 0;
    }
    refreshUnreadSummary();
  } catch (error) {
    if (!silent) {
      setNotice("error", errorText(error, "标记已读失败。"));
    }
  }
}

// ---------- 轮询与可见性 ----------

function startThreadPolling() {
  stopThreadPolling();
  threadTimer = window.setInterval(() => {
    if (!document.hidden) {
      pollThreadMessages();
    }
  }, THREAD_POLL_MS);
}

function stopThreadPolling() {
  if (threadTimer !== null) {
    clearInterval(threadTimer);
    threadTimer = null;
  }
}

// 页面重新可见时立即补刷角标与当前会话。
function handleVisibilityChange() {
  if (document.hidden) {
    return;
  }

  refreshUnreadSummary();
  if (activeThreadId.value) {
    pollThreadMessages();
  }
}

// ---------- 发送消息 ----------

async function sendMessage() {
  if (sending.value || isReadOnly.value) {
    return;
  }

  const content = draft.value.trim();
  if (!content) {
    setNotice("error", "消息内容不能为空。");
    return;
  }

  sending.value = true;
  setNotice("pending", "正在发送...");
  try {
    await messageApi.send({
      // 队伍会话显式带 threadId；其余情况交由后端解析。
      threadId:
        activeThread.value?.kind === "team"
          ? activeThread.value.threadId
          : undefined,
      content,
    });
    draft.value = "";
    setNotice("success", "已发送。");
    await fetchThreadMessages({ reset: false });
    await markActiveRead({ silent: true });
    await loadThreads();
  } catch (error) {
    setNotice("error", errorText(error, "发送失败。"));
  } finally {
    sending.value = false;
  }
}

// ---------- 问题反馈 ----------

function openFeedback() {
  feedbackOpen.value = true;
  feedbackDraft.value = "";
  notice.value = "";
}

async function submitFeedback() {
  if (feedbackSubmitting.value) {
    return;
  }

  const content = feedbackDraft.value.trim();
  if (!content) {
    setNotice("error", "反馈内容不能为空。");
    return;
  }

  feedbackSubmitting.value = true;
  setNotice("pending", "正在提交反馈...");
  try {
    await messageApi.feedback({ content });
    feedbackOpen.value = false;
    feedbackDraft.value = "";
    setNotice("success", "反馈已提交，官方回复会出现在「问题反馈」会话中。");
    await loadThreads();
  } catch (error) {
    setNotice("error", errorText(error, "提交反馈失败。"));
  } finally {
    feedbackSubmitting.value = false;
  }
}

// ---------- 人工求提示 ----------

async function loadTipsBalance() {
  if (!isLoggedIn.value) {
    return;
  }

  try {
    const response = await tipsApi.getBalance();
    const data = response?.data ?? {};
    // 无队伍时后端返回 200 + teamId:null + 零值，属正常空值，不是错误。
    tipsHasTeam.value = data.teamId !== null && data.teamId !== undefined;
    tipsBalance.value = Number(data.balance ?? 0) || 0;

    const cost = Number(data.rule?.hint_cost);
    if (Number.isFinite(cost) && cost > 0) {
      hintCost.value = cost;
    }
  } catch (error) {
    // 余额读取失败不阻塞页面，保持默认文案。
  }
}

async function requestHint() {
  if (hintSubmitting.value) {
    return;
  }

  // 服务端不做去重，连点会重复扣费：点击后立即禁用，直到本次响应返回。
  hintSubmitting.value = true;
  setNotice("pending", "正在请求人工提示...");
  try {
    const response = await messageApi.requestHint();
    const data = response?.data ?? {};
    const balance = Number(data.balance);
    if (Number.isFinite(balance)) {
      tipsBalance.value = balance;
    }
    setNotice(
      "success",
      `已提交求提示请求，扣除 ${data.cost ?? hintCost.value} 点。`,
    );
    await loadThreads();
    if (activeThreadId.value) {
      await pollThreadMessages();
    }
  } catch (error) {
    setNotice("error", errorText(error, "求提示失败。"));
  } finally {
    hintSubmitting.value = false;
  }
}

// ---------- 提示请求历史 ----------

async function openHintHistory() {
  hintHistoryOpen.value = true;
  hintRequests.value = [];
  hintNextCursor.value = null;
  await loadHintRequests({ reset: true });
}

async function loadHintRequests({ reset = false } = {}) {
  if (hintRequestsLoading.value) {
    return;
  }

  hintRequestsLoading.value = true;
  try {
    const response = await messageApi.getHintRequests({
      cursor: reset ? 0 : (hintNextCursor.value ?? 0),
      limit: 20,
    });
    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    hintRequests.value = reset ? items : [...hintRequests.value, ...items];
    hintNextCursor.value = data.nextCursor ?? null;
  } catch (error) {
    setNotice("error", errorText(error, "加载提示请求历史失败。"));
  } finally {
    hintRequestsLoading.value = false;
  }
}

function hintStatusLabel(status) {
  if (status === "pending") {
    return "待处理";
  }
  if (status === "answered") {
    return "已回复";
  }
  if (status === "rejected") {
    return "已拒绝（已退款）";
  }
  return status || "";
}

// ---------- 生命周期 ----------

onMounted(async () => {
  if (!isLoggedIn.value) {
    return;
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  await Promise.all([loadThreads(), loadTipsBalance(), refreshUnreadSummary()]);
  startThreadPolling();
});

onBeforeUnmount(() => {
  stopThreadPolling();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">通讯中心</p>
        <h1>站内信</h1>
      </div>

      <div v-if="isLoggedIn" class="page-shell__actions">
        <span class="user-chip">未读 {{ state.unreadMessages }}</span>
        <button class="soft-btn" type="button" @click="openFeedback">
          问题反馈
        </button>
        <button class="soft-btn" type="button" @click="loadThreads">
          刷新
        </button>
      </div>
    </header>

    <UserTabs />

    <p v-if="!isLoggedIn" class="helper-text">请先登录后查看站内信。</p>

    <div v-else class="mail-shell">
      <aside class="thread-list">
        <p v-if="threadsLoading && !threads.length" class="thread-hint">
          正在加载会话...
        </p>
        <p v-else-if="!threads.length" class="thread-hint">暂无会话。</p>

        <button
          v-for="thread in threads"
          :key="thread.threadId"
          type="button"
          :class="[
            'thread-item',
            { 'is-active': thread.threadId === activeThreadId },
          ]"
          @click="openThread(thread)"
        >
          <span class="thread-item__top">
            <strong>{{ threadName(thread) }}</strong>
            <span v-if="thread.unread > 0" class="thread-badge">
              {{ thread.unread }}
            </span>
          </span>
          <span class="thread-item__meta">
            <span class="thread-kind">{{ threadKindLabel(thread.kind) }}</span>
            <time>{{ formatTime(thread.lastMsgAt) }}</time>
          </span>
        </button>
      </aside>

      <main class="thread-panel">
        <template v-if="activeThread">
          <header class="thread-panel__head">
            <div class="thread-panel__title">
              <strong>{{ threadName(activeThread) }}</strong>
              <span class="thread-kind">
                {{ threadKindLabel(activeThread.kind) }}
              </span>
            </div>

            <div class="thread-panel__actions">
              <button
                v-if="canRequestHint"
                class="soft-btn"
                type="button"
                @click="openHintHistory"
              >
                提示记录
              </button>
              <template v-if="canRequestHint">
                <span class="tips-balance">
                  { tipsHasTeam ? `队伍 tips ${tipsBalance}` :
                  "加入队伍后开始累积" }
                </span>
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="hintSubmitting"
                  @click="requestHint"
                >
                  { hintSubmitting ? "请求中..." : `求人工提示（${hintCost}
                  点）` }
                </button>
              </template>
            </div>
          </header>

          <div class="message-scroll">
            <p v-if="!messages.length && !messagesLoading" class="thread-hint">
              {{ isReadOnly ? "暂无公告。" : "暂无消息，发送第一条消息吧。" }}
            </p>

            <article
              v-for="message in messages"
              :key="message.id"
              :class="[
                'message-bubble',
                message.direction === 'to_staff' ? 'is-mine' : 'is-theirs',
              ]"
            >
              <header class="message-bubble__head">
                <strong>{{ senderName(message) }}</strong>
                <time>{{ formatTime(message.createdAt) }}</time>
              </header>
              <p class="message-bubble__body">{{ message.content }}</p>
            </article>
          </div>

          <div class="thread-composer">
            <p v-if="isReadOnly" class="helper-text">
              官方公告为只读；如需联系工作人员，请使用「问题反馈」或队伍会话。
            </p>
            <template v-else>
              <textarea
                v-model="draft"
                rows="3"
                placeholder="输入消息内容，Ctrl+Enter 发送"
                aria-label="消息内容"
                @keydown.ctrl.enter="sendMessage"
              ></textarea>
              <div class="thread-composer__footer">
                <button
                  class="primary-btn"
                  type="button"
                  :disabled="sending"
                  @click="sendMessage"
                >
                  {{ sending ? "发送中..." : "发送" }}
                </button>
              </div>
            </template>
          </div>
        </template>

        <p v-else class="thread-hint thread-hint--center">
          请选择左侧会话查看消息。
        </p>
      </main>
    </div>

    <!-- 问题反馈 -->
    <div
      v-if="feedbackOpen"
      class="modal-backdrop"
      @click.self="feedbackOpen = false"
    >
      <div class="modal-card">
        <h2>问题反馈</h2>
        <p class="helper-text">
          提交后会进入你的专属反馈会话，官方回复会出现在同一会话中。
        </p>
        <textarea
          v-model="feedbackDraft"
          rows="6"
          maxlength="2000"
          placeholder="请描述你遇到的问题（最多 2000 字）"
          aria-label="反馈内容"
        ></textarea>
        <div class="modal-card__footer">
          <button class="soft-btn" type="button" @click="feedbackOpen = false">
            取消
          </button>
          <button
            class="primary-btn"
            type="button"
            :disabled="feedbackSubmitting"
            @click="submitFeedback"
          >
            {{ feedbackSubmitting ? "提交中..." : "提交反馈" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 提示请求历史 -->
    <div
      v-if="hintHistoryOpen"
      class="modal-backdrop"
      @click.self="hintHistoryOpen = false"
    >
      <div class="modal-card">
        <h2>提示请求记录</h2>
        <ul v-if="hintRequests.length" class="hint-list">
          <li v-for="item in hintRequests" :key="item.id">
            <span class="hint-list__id">#{{ item.id }}</span>
            <span class="hint-list__status">{{
              hintStatusLabel(item.status)
            }}</span>
            <span class="hint-list__cost">{{ item.cost }} 点</span>
            <time>{{ formatTime(item.createdAt) }}</time>
            <small v-if="item.reason">{{ item.reason }}</small>
          </li>
        </ul>
        <p v-else class="helper-text">
          {{ hintRequestsLoading ? "加载中..." : "暂无记录。" }}
        </p>
        <div class="modal-card__footer">
          <button
            v-if="hintNextCursor"
            class="soft-btn"
            type="button"
            :disabled="hintRequestsLoading"
            @click="loadHintRequests()"
          >
            加载更多
          </button>
          <button
            class="soft-btn"
            type="button"
            @click="hintHistoryOpen = false"
          >
            关闭
          </button>
        </div>
      </div>
    </div>

    <StatusMessage :message="notice" :tone="noticeType" />
  </section>
</template>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}

.page-shell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.page-shell__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-shell__title h1 {
  margin: 0;
  font-size: 28px;
}

.page-shell__eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.page-shell__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--surface-alt);
  font-size: 12px;
  color: var(--text-dim);
}

.soft-btn {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
  transition: 0.15s ease;
}

.soft-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
}

.soft-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary-btn {
  padding: 9px 18px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: linear-gradient(135deg, #0f7cff, #205ee2);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: 0.15s ease;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mail-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 14px;
}

/* 左侧会话列表 */
.thread-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 260px;
  flex-shrink: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  overflow: auto;
}

.thread-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.15s ease;
}

.thread-item:hover {
  background: color-mix(in srgb, var(--surface-alt) 70%, transparent);
}

.thread-item.is-active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 22%, transparent);
}

.thread-item__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.thread-item__top strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-dim);
}

.thread-kind {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 10px;
  color: var(--text-dim);
}

.thread-badge {
  min-width: 18px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--danger, #e5484d);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}

.thread-hint {
  margin: 8px 4px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

.thread-hint--center {
  margin: auto;
}

/* 右侧会话内容 */
.thread-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  overflow: hidden;
}

.thread-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 85%, transparent);
}

.thread-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.thread-panel__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.tips-balance {
  font-size: 12px;
  color: var(--text-dim);
}

.message-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.message-bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 78%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.message-bubble.is-mine {
  align-self: flex-end;
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 22%, transparent);
}

.message-bubble.is-theirs {
  align-self: flex-start;
  background: color-mix(in srgb, var(--surface-alt) 80%, transparent);
}

.message-bubble__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--text-dim);
}

.message-bubble__body {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.thread-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 60%, transparent);
}

.thread-composer textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  resize: vertical;
  box-sizing: border-box;
}

.thread-composer textarea:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
}

.thread-composer__footer {
  display: flex;
  justify-content: flex-end;
}

.helper-text {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

/* 弹窗 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(6, 10, 18, 0.55);
  z-index: 40;
}

.modal-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(520px, 100%);
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}

.modal-card h2 {
  margin: 0;
  font-size: 20px;
}

.modal-card textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-alt) 60%, transparent);
  color: var(--text);
  font: inherit;
  resize: vertical;
  box-sizing: border-box;
}

.modal-card textarea:focus {
  outline: none;
  border-color: var(--border-strong);
}

.modal-card__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.hint-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow: auto;
}

.hint-list li {
  display: grid;
  grid-template-columns: 56px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
}

.hint-list__id {
  color: var(--text-dim);
}

.hint-list__cost {
  color: var(--text-dim);
}

.hint-list time {
  color: var(--text-dim);
  white-space: nowrap;
}

.hint-list small {
  grid-column: 1 / -1;
  color: var(--text-dim);
  font-size: 11px;
}
</style>
