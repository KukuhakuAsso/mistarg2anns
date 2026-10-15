<script setup>
// 站内信中心：对接 /api/msg/*，界面为邮箱式（写信 / 收信）。
// 邮件分三类：system（官方公告，只读）、account（账号级邮件，问题反馈）。
// 注意：system 与 account 的 teamName 都是 null，必须用 kind 区分，不能只看 teamName。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useGameState } from "@/composables/useGameState";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { extractErrorMessage } from "@/api/errors";
import StatusMessage from "@/components/StatusMessage.vue";
import { messageApi } from "@/api/message";
import { tipsApi } from "@/api/tips";
import UserTabs from "@/components/UserTabs.vue";

const { state, currentTeam, loadMyTeam, refreshUnreadSummary } = useGameState();

// 当前页签：inbox = 收信，compose = 写信。
const activeTab = ref("inbox");
// 收信列表筛选：all = 全部，unread = 未读，read = 已读。
const inboxFilter = ref("all");

// 写信的收件人标识：写给官方走问题反馈接口，人工求提示走提示接口。
const OFFICIAL_TARGET = "official";
const HINT_TARGET = "hint";

// 邮件列表与当前打开的邮件内容
const threads = ref([]);
const threadsLoading = ref(false);
const activeThreadId = ref(null);
const messages = ref([]);
const messagesLoading = ref(false);
const lastId = ref(0);
// 已上报过的已读位置：轮询时 lastId 没前进就不重复发标记已读。
let lastMarkedReadId = 0;

// 写信页的收件人、草稿与提交状态。
const composeTarget = ref(OFFICIAL_TARGET);
const composeDraft = ref("");
const composing = ref(false);

// 操作提示的文案与语义色统一交给 useStatusMessage 管理。
const {
  message: notice,
  tone: noticeType,
  set: setNotice,
  clear: clearNotice,
} = useStatusMessage();

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
// 官方公告为只读，不显示回复框。
const isReadOnly = computed(() => activeThread.value?.kind === "system");
// 写信收件人选择「人工求提示」时，撰写页显示求提示面板。
const isHintCompose = computed(() => composeTarget.value === HINT_TARGET);

// 收信列表按未读状态筛选：未读判定为 unread > 0。
const filteredThreads = computed(() => {
  if (inboxFilter.value === "unread") {
    return threads.value.filter((item) => Number(item.unread) > 0);
  }

  if (inboxFilter.value === "read") {
    return threads.value.filter((item) => !(Number(item.unread) > 0));
  }

  return threads.value;
});

// 写信可选收件人：官方（问题反馈）与人工求提示。
const composeRecipients = [
  { value: OFFICIAL_TARGET, label: "官方 / 工作人员（问题反馈）" },
  { value: HINT_TARGET, label: "人工求提示" },
];

// 撰写页主题：默认「问题反馈」，可自行编辑，随反馈请求以 subject 字段提交。
const DEFAULT_SUBJECT = "问题反馈";
const composeSubject = ref(DEFAULT_SUBJECT);

// 错误文案统一由 @/api/errors 解析（含字段级原因），本地保留短名便于调用。
const errorText = extractErrorMessage;

// 邮件显示名与类型名都按 kind 区分（后端返回的 teamName 一律为 null）。
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
  return "邮件";
}

function threadKindLabel(kind) {
  if (kind === "system") {
    return "公告";
  }
  return "反馈";
}

// 邮件式署名：to_staff 表示自己发送，to_player 表示官方或工作人员（统一匿名）。
function senderName(message) {
  return message.direction === "to_staff" ? "我" : "官方 / 工作人员";
}

// 与署名互为收件方，用于详情页的「收件人」一行。
function recipientName(message) {
  return message.direction === "to_staff" ? "官方 / 工作人员" : "我";
}

// 邮件头像占位：取署名首字。
function senderInitial(message) {
  return senderName(message).slice(0, 1);
}

// 时间格式：列表用短格式（月-日 时:分），详情用带年份的完整格式。
function formatTime(value, { withYear = false } = {}) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withYear ? `${date.getFullYear()}-${day} ${clock}` : `${day} ${clock}`;
}

// ---------- 左侧功能列与收信筛选 ----------

// 左侧功能列的收信项：收件箱 = 全部邮件，另可按未读 / 已读筛选。
const INBOX_VIEWS = [
  { value: "all", label: "收件箱" },
  { value: "unread", label: "未读" },
  { value: "read", label: "已读" },
];

// 左侧功能列当前选中项：写信，或收信分类。
const activeView = computed(() =>
  activeTab.value === "compose" ? "compose" : inboxFilter.value,
);

// 右侧列表工具栏上的当前分类名。
const currentFolderLabel = computed(
  () =>
    INBOX_VIEWS.find((item) => item.value === inboxFilter.value)?.label ??
    "收件箱",
);

// 切换左侧功能列：选写信直接换成撰写页；选收信分类则回到列表（已打开的邮件先关闭）。
function switchView(view) {
  clearNotice();

  if (view === "compose") {
    activeTab.value = "compose";
    return;
  }

  activeTab.value = "inbox";
  inboxFilter.value = view;
  if (activeThreadId.value) {
    closeThread();
  }
}

// ---------- 邮件列表 ----------

async function loadThreads() {
  if (!isLoggedIn.value) {
    return;
  }

  threadsLoading.value = true;
  try {
    const response = await messageApi.getThreads();
    // 站内信不再提供队伍内通讯：后端若仍返回队伍会话，一律不展示。
    threads.value = (response?.data?.threads ?? []).filter(
      (item) => item.kind !== "team",
    );

    // 当前邮件已不可见时清空详情。
    if (!threads.value.some((item) => item.threadId === activeThreadId.value)) {
      activeThreadId.value = null;
      messages.value = [];
      lastId.value = 0;
    }
  } catch (error) {
    setNotice("error", errorText(error, "加载邮件列表失败。"));
  } finally {
    threadsLoading.value = false;
  }
}

// ---------- 邮件内容 ----------

async function openThread(thread) {
  activeThreadId.value = thread.threadId;
  messages.value = [];
  lastId.value = 0;
  lastMarkedReadId = 0;
  clearNotice();

  // 队伍邮件的抄送行需要成员名单；若队伍信息尚未加载（或早前加载失败），这里补拉一次。
  if (thread.kind === "team" && !currentTeam.value) {
    loadMyTeam();
  }

  await fetchThreadMessages({ reset: true });
  await markActiveRead();
  startThreadPolling();
}

// 关闭邮件详情，回到收信列表；顺带刷新未读角标。
function closeThread() {
  activeThreadId.value = null;
  messages.value = [];
  lastId.value = 0;
  stopThreadPolling();
  refreshUnreadSummary();
  loadThreads();
}

// reset=true 从头拉取；否则按 since_id 增量拉取并追加邮件。
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
    setNotice("error", errorText(error, "加载邮件内容失败。"));
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

// 更新已读位置；lastId 为 0（无消息）或没有前进过时跳过，
// 避免 10 秒轮询每次都重复上报（那会顺带重复刷新未读角标）。
async function markActiveRead({ silent = false } = {}) {
  const threadId = activeThreadId.value;
  if (!threadId || lastId.value <= 0 || lastId.value <= lastMarkedReadId) {
    return;
  }

  try {
    await messageApi.markRead(threadId, lastId.value);
    lastMarkedReadId = lastId.value;
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

// 页面重新可见时立即补刷当前邮件或列表（未读角标由 App.vue 的全局轮询负责）。
function handleVisibilityChange() {
  if (document.hidden) {
    return;
  }

  if (activeThreadId.value) {
    pollThreadMessages();
  } else {
    loadThreads();
  }
}

// ---------- 回复邮件：跳转到写信页 ----------

// 邮件详情页不再直接输入：点「回复」切到写信页，并把收件人预置为当前邮件。
// 官方公告不可回复（isReadOnly），按钮已禁用。
function replyToActiveThread() {
  if (!activeThread.value || isReadOnly.value) {
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
    await messageApi.send({ content });
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

// ---------- 写信 ----------

// 写信提交：收件人为官方时走问题反馈接口（回复落在「问题反馈」邮件），
// 为队伍时带上该邮件的 threadId 发送。
async function sendCompose() {
  if (composing.value) {
    return;
  }

  const subject = composeSubject.value.trim();
  if (!subject) {
    setNotice("error", "主题不能为空。");
    return;
  }

  const content = composeDraft.value.trim();
  if (!content) {
    setNotice("error", "正文不能为空。");
    return;
  }

  composing.value = true;
  setNotice("pending", "正在发送...");
  try {
    await messageApi.feedback({ subject, content });
    setNotice(
      "success",
      "已发送给官方 / 工作人员，回复会出现在「问题反馈」会话中。",
    );

    composeDraft.value = "";
    composeSubject.value = DEFAULT_SUBJECT;
    await loadThreads();
  } catch (error) {
    setNotice("error", errorText(error, "发送失败。"));
  } finally {
    composing.value = false;
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
  // 未读角标（GET /msg/summary）由 App.vue 的全局轮询统一负责，本页只加载自己的数据。
  await Promise.all([loadThreads(), loadTipsBalance(), loadMyTeam()]);
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
    </header>

    <UserTabs />

    <p v-if="!isLoggedIn" class="helper-text">请先登录后查看站内信。</p>

    <div v-else class="mail-layout">
      <!-- 左侧功能列：写信与各个收信分类 -->
      <aside class="mail-nav" aria-label="站内信功能">
        <button
          type="button"
          :class="['mail-nav__item', { 'is-active': activeView === 'compose' }]"
          @click="switchView('compose')"
        >
          写信
        </button>

        <p class="mail-nav__group">收信</p>

        <button
          v-for="item in INBOX_VIEWS"
          :key="item.value"
          type="button"
          :class="[
            'mail-nav__item',
            { 'is-active': activeView === item.value },
          ]"
          @click="switchView(item.value)"
        >
          <span>{{ item.label }}</span>
          <span
            v-if="item.value === 'unread' && state.unreadMessages > 0"
            class="unread-badge"
          >
            {{ state.unreadMessages }}
          </span>
        </button>
      </aside>

      <!-- 右侧邮件区：撰写页或收信面板 -->
      <div class="mail-main">
        <!-- 写信：收件人 / 主题 / 正文，与邮箱撰写一致 -->
        <div v-if="activeTab === 'compose'" class="composer">
          <div class="mail-meta">
            <div class="mail-row">
              <label class="label" for="compose-target">收件人</label>
              <select
                id="compose-target"
                v-model="composeTarget"
                class="select"
              >
                <option
                  v-for="item in composeRecipients"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </option>
              </select>
            </div>
            <div class="mail-row">
              <label class="label" for="compose-subject">主题</label>
              <input
                v-if="!isHintCompose"
                id="compose-subject"
                v-model="composeSubject"
                class="input"
                type="text"
                placeholder="请填写主题"
              />
              <span v-else class="value">人工求提示</span>
            </div>
          </div>

          <!-- 人工求提示：无正文，直接提交请求，并展示 tips 余额与消耗 -->
          <template v-if="isHintCompose">
            <div class="hint-panel">
              <p class="helper-text">
                人工求提示会消耗队伍 tips，提交后由工作人员答复，答复会出现在「问题反馈」会话中。
              </p>
              <p class="helper-text">
                当前 tips：{{ tipsHasTeam ? tipsBalance : "加入队伍后开始累积" }}；本次消耗
                {{ hintCost }} 点
              </p>
            </div>

            <div class="composer__footer">
              <button class="soft-btn" type="button" @click="openHintHistory">
                提示记录
              </button>
              <button
                class="primary-btn"
                type="button"
                :disabled="hintSubmitting || !tipsHasTeam"
                @click="requestHint"
              >
                {{
                  hintSubmitting ? "请求中..." : `求人工提示（${hintCost} 点）`
                }}
              </button>
            </div>
          </template>

          <!-- 问题反馈：正文 + 发送 -->
          <template v-else>
            <div class="toolbar">
              <label class="toolbar-label" for="compose-body">正文</label>
            </div>

            <textarea
              id="compose-body"
              v-model="composeDraft"
              class="mail-editor"
              rows="10"
              placeholder="请输入正文内容..."
            ></textarea>

            <div class="composer__footer">
              <button
                class="primary-btn"
                type="button"
                :disabled="composing"
                @click="sendCompose"
              >
                {{ composing ? "发送中..." : "发送" }}
              </button>
            </div>
          </template>
        </div>

        <!-- 收信：邮件列表与信件详情 -->
        <div v-else class="inbox-panel">
          <!-- 信件详情：邮件式版式，回复统一走写信页 -->
          <template v-if="activeThread">
            <header class="message-detail-header">
              <div class="toolbar-group">
                <button class="soft-btn" type="button" @click="closeThread">
                  返回收件箱
                </button>
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="isReadOnly"
                  :title="isReadOnly ? '官方公告不可回复' : '转到写信页回复'"
                  @click="replyToActiveThread"
                >
                  回复
                </button>
              </div>
              
            </header>

            <article class="message-detail">
              <h2 class="letter-subject">{{ threadSubject }}</h2>

              <div v-if="messagesLoading && !messages.length" class="list-hint">
                正在加载邮件...
              </div>
              <div v-else-if="!messages.length" class="list-hint">
                {{
                  isReadOnly ? "暂无公告。" : "暂无消息，点击「回复」进行写信。"
                }}
              </div>

              <div v-else class="letter-list">
                <article
                  v-for="message in messages"
                  :key="message.id"
                  class="letter"
                >
                  <header class="letter__head">
                    <div class="letter__from">
                      <strong>{{ senderName(message) }}</strong>
                      <small>收件人：{{ recipientName(message) }}</small>
                      <small v-if="letterCc.length">
                        抄送：{{ letterCc.join("、") }}
                      </small>
                    </div>
                    <time class="letter__time">
                      {{ formatTime(message.createdAt, { withYear: true }) }}
                    </time>
                  </header>
                  <p class="letter__body">{{ message.content }}</p>
                </article>
              </div>
            </article>

            <div class="reply-bar">
              <p v-if="isReadOnly" class="helper-text">
                官方公告为只读；如需联系工作人员，请使用「写信」。
              </p>
              <template v-else>
                <textarea
                  v-model="draft"
                  rows="3"
                  class="reply-input"
                  placeholder="输入消息内容，Ctrl+Enter 发送"
                  aria-label="消息内容"
                  @keydown.ctrl.enter="sendMessage"
                ></textarea>
                <div class="reply-bar__footer">
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

          <!-- 收件箱列表 -->
          <template v-else>
            <header class="inbox-toolbar">
              <span class="toolbar-label">{{ currentFolderLabel }}</span>

              <div class="toolbar-group toolbar-group--right">
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="threadsLoading"
                  @click="loadThreads"
                >
                  刷新
                </button>
              </div>
            </header>

            <div class="inbox-list">
              <div class="inbox-row inbox-row--head">
                <span>邮件</span>
                <span>最后消息</span>
                <span class="inbox-unread">未读</span>
              </div>

              <p v-if="threadsLoading && !threads.length" class="list-hint">
                正在加载邮件正文...
              </p>
              <p v-else-if="!filteredThreads.length" class="list-hint">
                暂无邮件记录。
              </p>

              <button
                v-for="thread in filteredThreads"
                :key="thread.threadId"
                type="button"
                :class="[
                  'inbox-row',
                  'inbox-row--button',
                  { 'is-unread': thread.unread > 0 },
                ]"
                @click="openThread(thread)"
              >
                <span class="inbox-subject">
                  <strong>{{ threadName(thread) }}</strong>
                  <small>{{ threadKindLabel(thread.kind) }}</small>
                </span>
                <span class="inbox-time">{{
                  formatTime(thread.lastMsgAt)
                }}</span>
                <span class="inbox-unread">
                  <span v-if="thread.unread > 0" class="unread-badge">
                    {{ thread.unread }}
                  </span>
                  <template v-else>—</template>
                </span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <StatusMessage class="shell-notice" :message="notice" :tone="noticeType" />

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
  </section>
</template>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-shell__head {
  display: flex;
  align-items: flex-start;
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

/* 通用按钮：功能列项、软按钮、主按钮共用一个基底，只靠各自的类上色。 */
.primary-btn,
.soft-btn {
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
  transition: 0.15s ease;
}

/* ---------- 邮箱布局：左侧功能列 + 右侧邮件区 ---------- */

.mail-layout {
  display: flex;
  align-items: stretch;
  gap: 16px;
  min-height: 0;
}

.mail-nav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 4px;
  width: 148px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
}

.mail-nav__group {
  margin: 10px 0 2px;
  padding: 0 12px;
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.mail-nav__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: 0.15s ease;
}

.mail-nav__item:hover {
  background: var(--surface-alt);
  color: var(--text);
}

.mail-nav__item.is-active {
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.mail-main {
  display: flex;
  flex: 1;
  min-width: 0;
}

.inbox-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 520px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  overflow: hidden;
}

/* ---------- 写信 ---------- */

.composer {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 520px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  overflow: hidden;
}

.mail-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--border);
}

.mail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.label {
  width: 70px;
  color: var(--text-dim);
  font-size: 12px;
}

.value {
  color: var(--text);
  font-size: 14px;
}

.select {
  min-width: 260px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

/* 可编辑的主题输入框：与收件人下拉同一套外观。 */
.input {
  flex: 1;
  min-width: 260px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.toolbar {
  display: flex;
  align-items: center;
  padding: 10px 18px 0;
}

.toolbar-label {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--surface-alt);
  color: var(--text-dim);
  font-size: 12px;
}

.mail-editor {
  flex: 1;
  margin: 14px 18px 18px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  line-height: 1.8;
  resize: vertical;
}

.mail-editor:focus,
.reply-input:focus,
.input:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
}

.composer__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 18px 16px;
}

/* 撰写页的求提示面板：占满正文区，操作按钮固定在底部。 */
.hint-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
}

.primary-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #0f7cff, #205ee2);
  color: #fff;
  font-weight: 600;
}

.primary-btn:disabled,
.soft-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shell-notice {
  margin: 0;
}

/* ---------- 收件箱列表 ---------- */

.inbox-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 85%, transparent);
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.toolbar-group--right {
  justify-content: flex-end;
}

.soft-btn {
  padding: 7px 12px;
  border-color: var(--border);
  background: var(--surface);
  color: var(--text-dim);
}

.soft-btn.is-selected {
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
  background: var(--accent-soft);
  color: var(--accent);
}

.inbox-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

.inbox-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px 64px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
}

.inbox-row--head {
  background: color-mix(in srgb, var(--surface-alt) 92%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}

/* 整行可点：去掉按钮默认外观，保留表格行的观感。 */
.inbox-row--button {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--border);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.inbox-row--button:hover {
  background: var(--accent-soft);
}

.inbox-row.is-unread {
  background: color-mix(in srgb, var(--surface) 92%, transparent);
}

.inbox-row.is-unread .inbox-subject strong {
  font-weight: 700;
}

.inbox-subject {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.inbox-subject strong {
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inbox-subject small {
  color: var(--text-dim);
  font-size: 11px;
}

.inbox-time {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}

.inbox-unread {
  display: flex;
  justify-content: flex-end;
  color: var(--text-dim);
  font-size: 12px;
}

.unread-badge {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

.list-hint {
  margin: 0;
  padding: 16px;
  color: var(--text-dim);
  font-size: 12px;
}

/* ---------- 信件详情 ---------- */

.message-detail-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 88%, transparent);
}

.message-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 20px 24px 24px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
  overflow: auto;
}

/* ---------- 信件详情：邮件式版式 ---------- */

/* 主题行：邮件标题，压在正文与头部之间。 */
.letter-subject {
  margin: 0;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 20px;
  line-height: 1.4;
}

/* 多条消息按时间顺序纵向排列，每条是一封独立信件。 */
.letter-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 18px;
}

.letter {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 18px;
  border-bottom: 1px dashed var(--border);
}

.letter:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

/* 信件头：中间发件人 / 收件人，右侧时间。 */
.letter__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.letter__from {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.letter__from strong {
  color: var(--text);
  font-size: 13px;
}

.letter__from small {
  color: var(--text-dim);
  font-size: 11px;
}

.letter__time {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
}

.letter__body {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
}

.helper-text {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

/* ---------- 提示请求历史弹窗 ---------- */

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(8, 13, 20, 0.55);
}

.modal-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(560px, 100%);
  max-height: 80vh;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  overflow: auto;
}

.modal-card h2 {
  margin: 0;
  font-size: 18px;
}

.modal-card__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.hint-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hint-list li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 64px 110px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
}

.hint-list li small {
  grid-column: 1 / -1;
  color: var(--text-dim);
}

.hint-list__id,
.hint-list__cost,
.hint-list time {
  color: var(--text-dim);
}

@media (max-width: 960px) {
  .inbox-row {
    grid-template-columns: minmax(0, 1fr) 96px 52px;
    gap: 8px;
    padding: 10px 12px;
  }

  /* 窄屏下功能列改为横向排列在邮件区上方。 */
  .mail-layout {
    flex-direction: column;
  }

  .mail-nav {
    flex-direction: row;
    flex-wrap: wrap;
    width: auto;
  }

  .mail-nav__group {
    margin: 0;
    align-self: center;
  }
}
</style>
