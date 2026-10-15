<script setup>
// 站内信中心：对接 /api/msg/mails（邮件式）。
// 列表按「每次发信一行」平铺，只给主题与来源；正文与附件要点进详情，
// 详情一次返回整段对话（根 + 全部回复）。能否回复由服务端的 canReply 决定（官方公告为 false），
// 队伍会话（channel=team）在玩家侧只读：只用于接收官方消息，不再支持队伍内通讯。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useGameState } from "@/composables/useGameState";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { extractErrorMessage } from "@/api/errors";
import StatusMessage from "@/components/StatusMessage.vue";
import { messageApi } from "@/api/message";
import UserTabs from "@/components/UserTabs.vue";

const { state, refreshUnreadSummary, refreshTeamTips } = useGameState();

// 当前页签：inbox = 收信，compose = 写信。
const activeTab = ref("inbox");
// 收信列表筛选：all = 全部，unread = 未读，read = 已读。
const inboxFilter = ref("all");
// 列表筛选的频道口径："" = 全部频道，否则为 system / account / team。
const channelFilter = ref("");
// 列表筛选的来源口径："" = 全部来源，否则为 source 枚举
//（mail / feedback / hint / announce / warn / system）。
const sourceFilter = ref("");

// 写信的收件人标识：写给官方走问题反馈接口，请求提示走提示接口。
const OFFICIAL_TARGET = "official";
const HINT_TARGET = "hint";

// 邮件列表（每次发信一行）与分页游标
const mails = ref([]);
const mailsLoading = ref(false);
const mailsCursor = ref(null);
const mailsHasMore = ref(false);
const MAILS_PAGE_SIZE = 20;

// 当前打开的邮件对话：activeMailId 用列表里的 mailId，服务端会归一到所在对话的根。
const activeMailId = ref(null);
const mail = ref(null);
const messages = ref([]);
const messagesLoading = ref(false);
const lastId = ref(0);
// 已上报过的已读位置：轮询时 lastId 没前进就不重复发标记已读。
let lastMarkedReadId = 0;

// 写信页的收件人、主题、草稿与提交状态。
const composeTarget = ref(OFFICIAL_TARGET);
const composeSubject = ref("");
const composeDraft = ref("");
const composing = ref(false);
// 回复模式：非空表示这是对某封邮件的回复（主题由服务端按根主题生成）
const composeReplyTo = ref(null);

// 操作提示的文案与语义色统一交给 useStatusMessage 管理。
const {
  message: notice,
  tone: noticeType,
  set: setNotice,
  clear: clearNotice,
} = useStatusMessage();

// 求提示：当前请求（提问 → 等报价 → 报价待确认 → 已答复 / 已拒绝 / 已关闭）。
// 报价挂在请求上：quotedCost 是当前有效报价（降价后就是新价），确认时才按它扣费。
const hintQuestion = ref("");
const hintSubmitting = ref(false);
// 正在执行的动作用途名（confirm / cheaper / close），用于禁用按钮防重复提交
const hintActing = ref("");
const activeHint = ref(null);
// 待报价名额：每队同时只能有 1 条（配额提示用）
const hintPendingCount = ref(0);
// 玩家端没有组件库，确认弹窗复用页面里的 modal 样式：{ title, text, confirmText, run }
const hintConfirm = ref(null);
// 本队 tips 余额与今日累积：与顶栏共用全局状态，同队任何人消费后两边一起变
const tipsBalance = computed(() => state.teamTips.balance);
const tipsHasTeam = computed(() => state.teamTips.hasTeam);
const tipsToday = computed(() => state.teamTips.today);

// 提示请求历史
const hintHistoryOpen = ref(false);
const hintRequests = ref([]);
const hintRequestsLoading = ref(false);
const hintNextCursor = ref(null);

// 提问后每 10 秒查一次报价，直到不再是 pending；申请更便宜等官方回应期间同样要盯着。
const HINT_POLL_MS = 10000;
let hintTimer = null;

const MAIL_POLL_MS = 10000;
let mailTimer = null;

const isLoggedIn = computed(() => Boolean(state.user.currentUser));
// 详情里的根邮件摘要（服务端归一后的 mail）
// 玩家可回复的邮件：服务端的 canReply（官方公告为 false）；
// 队伍会话只用于接收官方消息（后端已不再支持队伍内通讯），玩家侧一律只读。
const canReply = computed(
  () => Boolean(mail.value?.canReply) && mail.value?.channel !== "team",
);
// 不可回复时的按钮提示与说明文案
const replyDisabledReason = computed(() =>
  mail.value?.channel === "team" ? "队伍警告无需回复" : "这封邮件不可回复",
);
const readOnlyHint = computed(() =>
  mail.value?.channel === "team"
    ? "队伍会话只用于接收官方消息（如官方警告），无法在此发言。"
    : "这封邮件不可回复（如官方公告）；如需联系工作人员，请使用「写信」。",
);
// 写信收件人选择「请求提示」时，撰写页显示求提示面板。
const isHintCompose = computed(() => composeTarget.value === HINT_TARGET);

// ---------- 求提示的派生状态（口径见 api-10 §10.12） ----------

const hintStatus = computed(() => activeHint.value?.status ?? null);
// 待报价名额已占满（每队上限 1）
const hintQuotaFull = computed(() => hintPendingCount.value >= 1);
// 可申请更便宜：已报价、没申请过、官方也没表示过是最低价
const canRequestCheaper = computed(
  () =>
    hintStatus.value === "quoted" &&
    !activeHint.value?.cheaperRequestedAt &&
    !activeHint.value?.isLowestPrice,
);
// 已申请更便宜、官方还没回应
const cheaperPending = computed(
  () =>
    Boolean(activeHint.value?.cheaperRequestedAt) &&
    !activeHint.value?.cheaperDecidedAt,
);
// 需要轮询：等报价中，或等官方回应议价
const hintNeedsPolling = computed(
  () => Boolean(activeHint.value) && (hintStatus.value === "pending" || cheaperPending.value),
);
// 回复模式下的主题预览：服务端会生成「回复：<根主题>」
const replySubject = computed(() =>
  mail.value?.subject ? `回复：${mail.value.subject}` : "回复",
);

// 这封邮件（对话）的发件人 = 根记录的发送者：列表与详情抬头都用它。
const mailSender = computed(() => {
  const root =
    messages.value.find((message) => message.isRoot) ?? messages.value[0];
  return root ? senderName(root) : "—";
});

// 列表筛选：「未读」与频道交给服务端（only_unread / channel）；
// 「已读」与来源服务端没有对应参数，按已加载的记录过滤。三者叠加生效。
const filteredMails = computed(() =>
  mails.value.filter((item) => {
    if (inboxFilter.value === "read" && Number(item.unread) > 0) {
      return false;
    }
    if (sourceFilter.value && item.source !== sourceFilter.value) {
      return false;
    }
    return true;
  }),
);

// 空列表提示：来源 / 已读是客户端筛选，可能只是把已加载的记录都滤掉了。
const emptyHint = computed(() =>
  sourceFilter.value || inboxFilter.value === "read"
    ? "已加载的邮件中没有符合条件的记录；可点「加载更早的邮件」继续查找。"
    : "暂无邮件记录。",
);

// 写信可选收件人：官方（问题反馈）与请求提示。
const composeRecipients = [
  { value: OFFICIAL_TARGET, label: "官方 / 工作人员（问题反馈）" },
  { value: HINT_TARGET, label: "请求提示" },
];

// 错误文案统一由 @/api/errors 解析（含字段级原因），本地保留短名便于调用。
const errorText = extractErrorMessage;

// 来源标记（服务端判定，客户端不能指定）
const SOURCE_LABEL = {
  mail: "邮件",
  feedback: "问题反馈",
  hint: "求提示",
  announce: "公告",
  warn: "官方警告",
  system: "系统消息",
};

function sourceLabel(source) {
  return SOURCE_LABEL[source] || "邮件";
}

// 发送者：以服务端返回的 from 为准；系统身份（公告 / 警告）三项都是 null，
// 发送者是自己账号时显示「我」。
function senderName(message) {
  const from = message.from ?? {};
  if (from.id === null || from.id === undefined) {
    return "官方 / 系统";
  }
  if (String(from.id) === String(state.user.currentUser?.id)) {
    return "我";
  }
  return from.name || `#${from.id}`;
}

// 与署名互为收件方（接口只给方向，不给逐条收件人）。
function recipientName(message) {
  return message.direction === "to_staff" ? "官方 / 工作人员" : "我";
}

// 发件人角色：from.role 是真实角色（系统身份为 null），列表里作为悬停提示补充说明。
const ROLE_LABEL = {
  player: "玩家",
  captain: "队长",
  staff: "工作人员",
  admin: "管理员",
};

function senderRoleLabel(message) {
  const role = message.from?.role;
  const label = ROLE_LABEL[role];
  return label ? `${senderName(message)} · ${label}` : senderName(message);
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

// 左侧功能列的频道项：与服务端 channel 参数一一对应（channelName 由服务端下发，
// 列表里显示的是带队名的完整名称，这里只用于筛选）。
const CHANNEL_VIEWS = [
  { value: "", label: "全部频道" },
  { value: "system", label: "官方公告" },
  { value: "account", label: "与官方的联系" },
  { value: "team", label: "队伍会话" },
];

// 左侧功能列的来源项：取值即服务端的 source 枚举（顺序也照本章契约表）。
// 列表接口没有 source 参数，这一维由前端在已加载的邮件上过滤。
const SOURCE_VIEWS = [
  { value: "", label: "全部来源" },
  ...Object.keys(SOURCE_LABEL).map((value) => ({
    value,
    label: SOURCE_LABEL[value],
  })),
];

// 左侧功能列当前选中项：写信，或收信分类。
const activeView = computed(() =>
  activeTab.value === "compose" ? "compose" : inboxFilter.value,
);

// 频道 / 来源项的选中态；撰写页不选中任何项。
const activeChannel = computed(() =>
  activeTab.value === "compose" ? null : channelFilter.value,
);
const activeSource = computed(() =>
  activeTab.value === "compose" ? null : sourceFilter.value,
);

// 右侧列表工具栏上的当前分类名：收信分类 + 频道 + 来源（「全部」的段位省略）。
const currentFolderLabel = computed(() => {
  const inboxLabel =
    INBOX_VIEWS.find((item) => item.value === inboxFilter.value)?.label ??
    "收件箱";
  const channelLabel =
    CHANNEL_VIEWS.find((item) => item.value === channelFilter.value)?.label ?? "";
  const sourceLabel2 =
    SOURCE_VIEWS.find((item) => item.value === sourceFilter.value)?.label ?? "";

  return [inboxLabel, channelLabel, sourceLabel2].filter(Boolean).join(" · ");
});

// 切换左侧功能列：选写信直接换成撰写页；选收信分类则回到列表（已打开的邮件先关闭）。
function switchView(view) {
  clearNotice();

  if (view === "compose") {
    activeTab.value = "compose";
    return;
  }

  const filterChanged = inboxFilter.value !== view;
  activeTab.value = "inbox";
  inboxFilter.value = view;
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  } else if (filterChanged) {
    loadMails();
  }
}

// 切换来源：这一维由前端在已加载的邮件上过滤（接口没有 source 参数），不需要重新请求。
function switchSource(source) {
  clearNotice();
  activeTab.value = "inbox";
  sourceFilter.value = source;
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  }
}

// 左侧「写信」：清掉回复上下文，写一封新邮件。
function startNewMail() {
  composeReplyTo.value = null;
  composeTarget.value = OFFICIAL_TARGET;
  switchView("compose");
}

// 切换频道：只动 channel 参数，与收信分类（全部 / 未读 / 已读）叠加生效。
function switchChannel(channel) {
  clearNotice();
  activeTab.value = "inbox";
  channelFilter.value = channel;
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  } else {
    loadMails();
  }
}

// ---------- 邮件列表 ----------

async function loadMails({ append = false } = {}) {
  if (!isLoggedIn.value) {
    return;
  }

  mailsLoading.value = true;
  try {
    const response = await messageApi.getMails({
      cursor: append ? (mailsCursor.value ?? 0) : 0,
      limit: MAILS_PAGE_SIZE,
      // 「未读」按对话判定，交给服务端过滤
      onlyUnread: inboxFilter.value === "unread",
      // 频道筛选也交给服务端（空值 = 不限频道）
      channel: channelFilter.value || undefined,
    });
    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];

    mails.value = append ? [...mails.value, ...items] : items;
    mailsCursor.value = data.nextCursor ?? null;
    mailsHasMore.value = Boolean(data.hasMore);
  } catch (error) {
    setNotice("error", errorText(error, "加载邮件列表失败。"));
  } finally {
    mailsLoading.value = false;
  }
}

// ---------- 邮件详情 ----------

// 打开一封邮件：id 传列表里的 mailId，服务端会归一到所在对话的根。
async function openMail(mailId) {
  activeMailId.value = mailId;
  mail.value = null;
  messages.value = [];
  lastId.value = 0;
  lastMarkedReadId = 0;
  clearNotice();

  await fetchMail({ reset: true });
  await markActiveRead();
  startMailPolling();
}

// 关闭邮件详情，回到收信列表；顺带刷新未读角标。
function closeMail() {
  activeMailId.value = null;
  mail.value = null;
  messages.value = [];
  lastId.value = 0;
  stopMailPolling();
  refreshUnreadSummary();
  loadMails();
}

// since_id 增量响应里没有根记录，mail 的 subject / source / direction / createdAt 会是 null，
// 合并时跳过空值，保留首次详情里的值。
function mergeMail(current, incoming) {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }

  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

// reset=true 从头拉整段对话；否则按 since_id 增量拉取并追加。
async function fetchMail({ reset = false } = {}) {
  const mailId = activeMailId.value;
  if (!mailId) {
    return;
  }

  messagesLoading.value = true;
  try {
    const response = await messageApi.getMail(mailId, {
      sinceId: reset ? 0 : lastId.value,
    });
    const data = response?.data ?? {};
    const incoming = Array.isArray(data.messages) ? data.messages : [];

    mail.value = reset ? (data.mail ?? null) : mergeMail(mail.value, data.mail);

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
async function pollMail() {
  if (!activeMailId.value) {
    return;
  }

  await fetchMail({ reset: false });
  await markActiveRead({ silent: true });
}

// 更新已读位置；lastId 为 0（无记录）或没有前进过时跳过，
// 避免 10 秒轮询每次都重复上报（那会顺带重复刷新未读角标）。
async function markActiveRead({ silent = false } = {}) {
  const mailId = activeMailId.value;
  if (!mailId || lastId.value <= 0 || lastId.value <= lastMarkedReadId) {
    return;
  }

  try {
    await messageApi.markRead(mailId, lastId.value);
    lastMarkedReadId = lastId.value;

    // unread 是对话级的：同一对话的每一行都要清零
    const rootId = mail.value?.mailId ?? mailId;
    for (const item of mails.value) {
      if ((item.rootMsgId ?? item.mailId) === rootId) {
        item.unread = 0;
      }
    }
    if (mail.value) {
      mail.value.unread = 0;
    }
    refreshUnreadSummary();
  } catch (error) {
    if (!silent) {
      setNotice("error", errorText(error, "标记已读失败。"));
    }
  }
}

// ---------- 轮询与可见性 ----------

function startMailPolling() {
  stopMailPolling();
  mailTimer = window.setInterval(() => {
    if (!document.hidden) {
      pollMail();
    }
  }, MAIL_POLL_MS);
}

function stopMailPolling() {
  if (mailTimer !== null) {
    clearInterval(mailTimer);
    mailTimer = null;
  }
}

// 页面重新可见时立即补刷当前邮件 / 列表，以及正在等报价的求提示。
function handleVisibilityChange() {
  if (document.hidden) {
    return;
  }

  if (activeMailId.value) {
    pollMail();
  } else {
    loadMails();
  }

  if (hintNeedsPolling.value) {
    loadActiveHint();
  }
}

// ---------- 回复邮件：跳转到写信页 ----------

// 邮件详情页不直接输入：点「回复」切到写信页，目标预置为当前对话的根邮件；
// 主题由服务端按根主题生成（回复：<根主题>）。canReply=false（官方公告）时按钮已禁用。
function replyToActiveMail() {
  if (!mail.value || !canReply.value) {
    return;
  }

  composeReplyTo.value = mail.value.mailId;
  switchView("compose");
}

// ---------- 写信 ----------

// 写信提交：回复走发信接口（不传主题，服务端生成）；新邮件走问题反馈接口。
async function sendCompose() {
  if (composing.value) {
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
    if (composeReplyTo.value) {
      const mailId = composeReplyTo.value;
      await messageApi.sendMail({ replyTo: mailId, content });

      composeDraft.value = "";
      composeReplyTo.value = null;
      // 回到刚才的对话，直接看到刚发出的记录
      activeTab.value = "inbox";
      await loadMails();
      await openMail(mailId);
      setNotice("success", "回复已发出。");
    } else {
      // 主题可选：留空时服务端取正文首行
      const subject = composeSubject.value.trim();
      await messageApi.feedback({ subject: subject || undefined, content });
      setNotice(
        "success",
        "已发送给官方 / 工作人员，回复会出现在「与官方的联系」中。",
      );

      composeDraft.value = "";
      composeSubject.value = "";
      await loadMails();
    }
  } catch (error) {
    setNotice("error", errorText(error, "发送失败。"));
  } finally {
    composing.value = false;
  }
}

// ---------- 求提示 ----------

// 余额统一由全局状态持有（顶部栏也读同一份），这里只负责触发刷新。
async function loadTipsBalance() {
  if (!isLoggedIn.value) {
    return;
  }

  await refreshTeamTips();
}

// 把最新的请求写回状态，并按需要开/关轮询。
function applyActiveHint(next) {
  activeHint.value = next ?? null;
  syncHintPolling();
}

async function loadActiveHint() {
  if (!activeHint.value?.id) {
    return;
  }

  try {
    const response = await messageApi.getHintRequest(activeHint.value.id);
    applyActiveHint(response?.data ?? null);
  } catch (error) {
    // 轮询失败静默处理：下一次 tick 会重试，避免刷屏报错。
  }
}

// 提问：只提交问题，不扣费；提交后开始等报价。
async function submitHintQuestion() {
  if (hintSubmitting.value) {
    return;
  }

  const content = hintQuestion.value.trim();
  if (!content) {
    setNotice("error", "请先填写问题描述。");
    return;
  }

  hintSubmitting.value = true;
  setNotice("pending", "正在提交求提示...");
  try {
    const response = await messageApi.requestHint({ content });
    const data = response?.data ?? {};
    hintQuestion.value = "";
    hintPendingCount.value = Number(data.pendingCount ?? 1) || 1;
    // 提问响应就是待报价状态，直接落到当前请求上，省一次 GET
    applyActiveHint({
      id: data.requestId,
      status: data.status ?? "pending",
      question: data.question ?? content,
      cost: data.cost ?? null,
      quotedCost: data.quotedCost ?? null,
      cheaperRequestedAt: null,
      cheaperDecidedAt: null,
      isLowestPrice: false,
      createdAt: new Date().toISOString(),
      decidedAt: null,
      replyMsgId: null,
      reason: null,
    });
    setNotice("success", "已提交，等待官方报价（报价前不扣点数）。");
  } catch (error) {
    setNotice("error", errorText(error, "提交求提示失败。"));
  } finally {
    hintSubmitting.value = false;
  }
}

// 确认扣费：按当前报价扣本队 tips，答复随后进队伍会话。
async function confirmActiveHint() {
  if (hintActing.value || !activeHint.value) {
    return;
  }

  const id = activeHint.value.id;
  hintActing.value = "confirm";
  setNotice("pending", "正在确认...");
  try {
    const response = await messageApi.confirmHint(id);
    const data = response?.data ?? {};
    applyActiveHint({ ...activeHint.value, status: data.status ?? "answered", cost: data.cost ?? null, replyMsgId: data.msgId ?? null });
    hintPendingCount.value = 0;
    setNotice(
      "success",
      `已确认，扣除 ${data.cost ?? 0} 点；答复已发到「队伍会话」，可在收件箱查看。`,
    );
    // 答复是一条新邮件，顺带刷新列表与余额
    await Promise.all([loadMails(), loadTipsBalance()]);
  } catch (error) {
    // 余额不足不是死路：报价保留，补点数后重试同一条即可
    if (error?.code === "E_TIPS_SHORT") {
      const detail = error?.payload?.error?.detail ?? {};
      setNotice(
        "error",
        `本队 tips 不足（需要 ${detail.required ?? "?"}，当前 ${detail.balance ?? tipsBalance.value}）；补齐后可再次确认这条报价。`,
      );
    } else {
      setNotice("error", errorText(error, "确认失败。"));
    }
    // 状态可能已被别处改动（如已处理），拉一次最新状态
    await loadActiveHint();
  } finally {
    hintActing.value = "";
  }
}

// 申请更便宜：整个提问只允许一次，不加价、不扣费；
// 「可能答不全」这句提醒必须由前端在发请求之前给出（后端不提供）。
function requestCheaper() {
  if (hintActing.value || !canRequestCheaper.value) {
    return;
  }

  hintConfirm.value = {
    title: "申请更便宜",
    text: "更便宜的提示可能无法回答所有问题，确定要申请吗？",
    confirmText: "申请",
    run: submitCheaper,
  };
}

async function submitCheaper() {
  const id = activeHint.value?.id;
  hintConfirm.value = null;
  if (!id) {
    return;
  }

  hintActing.value = "cheaper";
  try {
    await messageApi.requestCheaperHint(id);
    setNotice("success", "已申请，等待官方回应；期间也可以直接按当前价确认。");
  } catch (error) {
    setNotice("error", errorText(error, "申请失败。"));
  } finally {
    hintActing.value = "";
    // 409（已申请过 / 已是最低价）时以服务端状态为准，把入口置灰
    await loadActiveHint();
  }
}

// 关闭请求：放弃这条提示，服务端会清掉已备好的答复。
function closeActiveHint() {
  if (hintActing.value || !activeHint.value) {
    return;
  }

  hintConfirm.value = {
    title: "关闭求提示",
    text: "关闭后将放弃这条求提示（已备好的答复也会被清除），确认关闭？",
    confirmText: "关闭",
    run: submitClose,
  };
}

async function submitClose() {
  const id = activeHint.value?.id;
  hintConfirm.value = null;
  if (!id) {
    return;
  }

  hintActing.value = "close";
  try {
    const response = await messageApi.closeHint(id);
    const data = response?.data ?? {};
    applyActiveHint({ ...activeHint.value, status: data.status ?? "closed" });
    hintPendingCount.value = 0;
    setNotice(
      "success",
      Number(data.refunded) > 0
        ? `已关闭，退回 ${data.refunded} 点。`
        : "已关闭。",
    );
    await Promise.all([loadTipsBalance(), loadHintRequests({ reset: true })]);
  } catch (error) {
    setNotice("error", errorText(error, "关闭失败。"));
    await loadActiveHint();
  } finally {
    hintActing.value = "";
  }
}

// 重新提一条：清掉当前请求，回到提问表单。
function startNewHint() {
  applyActiveHint(null);
  hintQuestion.value = "";
}

// 从历史里挑一条继续操作（把某个请求设成当前请求）。
async function selectHintRequest(item) {
  hintHistoryOpen.value = false;
  applyActiveHint(item);
  clearNotice();
  await loadActiveHint();
}

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
    hintPendingCount.value = Number(data.pendingCount ?? 0) || 0;
  } catch (error) {
    setNotice("error", errorText(error, "加载提示请求历史失败。"));
  } finally {
    hintRequestsLoading.value = false;
  }
}

// 刷新页面后恢复「当前请求」：优先还没报价的那条，其次是已报价等确认的。
async function restoreActiveHint() {
  try {
    const response = await messageApi.getHintRequests({ limit: 20 });
    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    hintPendingCount.value = Number(data.pendingCount ?? 0) || 0;

    const active =
      items.find((item) => item.status === "pending") ??
      items.find((item) => item.status === "quoted") ??
      null;
    if (active) {
      applyActiveHint(active);
    }
  } catch (error) {
    // 恢复失败不影响页面其他部分
  }
}

function hintStatusLabel(status) {
  if (status === "pending") {
    return "待报价";
  }
  if (status === "quoted") {
    return "待确认";
  }
  if (status === "answered") {
    return "已答复";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  if (status === "closed") {
    return "已关闭";
  }
  return status || "";
}

// 历史里的点数：确认前 cost 恒为 null，此时显示当前报价
function hintCostText(item) {
  if (item.cost !== null && item.cost !== undefined) {
    return `${item.cost} 点`;
  }
  if (item.quotedCost !== null && item.quotedCost !== undefined) {
    return `报价 ${item.quotedCost} 点`;
  }
  return "—";
}

// 已等待时长（待报价时用 createdAt 计时）
function waitedText(value) {
  if (!value) {
    return "—";
  }
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

// ---------- 提示请求的轮询 ----------

function syncHintPolling() {
  if (hintNeedsPolling.value) {
    startHintPolling();
  } else {
    stopHintPolling();
  }
}

function startHintPolling() {
  if (hintTimer !== null) {
    return;
  }

  hintTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadActiveHint();
    }
  }, HINT_POLL_MS);
}

function stopHintPolling() {
  if (hintTimer !== null) {
    clearInterval(hintTimer);
    hintTimer = null;
  }
}

// ---------- 生命周期 ----------

onMounted(async () => {
  if (!isLoggedIn.value) {
    return;
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  // 未读角标（GET /msg/mails/summary）由 App.vue 的全局轮询统一负责，本页只加载自己的数据。
  await Promise.all([loadMails(), loadTipsBalance(), restoreActiveHint()]);
});

onBeforeUnmount(() => {
  stopMailPolling();
  stopHintPolling();
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
      <!-- 左侧功能列：写信、收信分类、频道与来源筛选 -->
      <aside class="mail-nav" aria-label="站内信功能">
        <button
          type="button"
          :class="['mail-nav__item', { 'is-active': activeView === 'compose' }]"
          @click="startNewMail"
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

        <p class="mail-nav__group">频道</p>

        <button
          v-for="item in CHANNEL_VIEWS"
          :key="item.value || 'all'"
          type="button"
          :class="[
            'mail-nav__item',
            { 'is-active': activeChannel === item.value },
          ]"
          @click="switchChannel(item.value)"
        >
          <span>{{ item.label }}</span>
        </button>

        <p class="mail-nav__group">来源</p>

        <button
          v-for="item in SOURCE_VIEWS"
          :key="item.value || 'all'"
          type="button"
          :class="[
            'mail-nav__item',
            { 'is-active': activeSource === item.value },
          ]"
          @click="switchSource(item.value)"
        >
          <span>{{ item.label }}</span>
        </button>
      </aside>

      <!-- 右侧邮件区：撰写页或收信面板 -->
      <div class="mail-main">
        <!-- 写信：收件人 / 主题 / 正文，与邮箱撰写一致 -->
        <div v-if="activeTab === 'compose'" class="composer">
          <div class="mail-meta">
            <div class="mail-row">
              <span class="label">收件人</span>
              <select
                v-if="!composeReplyTo"
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
              <span v-else class="value">
                {{ mail?.channelName || "当前对话" }}（回复）
              </span>
            </div>
            <div class="mail-row">
              <span class="label">主题</span>
              <span v-if="composeReplyTo" class="value">{{ replySubject }}</span>
              <span v-else-if="isHintCompose" class="value">请求提示</span>
              <input
                v-else
                id="compose-subject"
                v-model="composeSubject"
                class="input"
                type="text"
                maxlength="80"
                placeholder="选填，留空时取正文首行"
              />
            </div>
          </div>

          <!-- 请求提示：先提问（不扣费），官方报价后由玩家确认扣费；答复进队伍会话 -->
          <template v-if="isHintCompose">
            <div class="hint-panel">
              <p class="helper-text">
                求提示不预扣点数：先提问，官方报价后由你确认，确认时才扣本队 tips；答复会作为站内信发到「队伍会话」。
              </p>
              <p class="helper-text">
                本队 tips：{{ tipsHasTeam ? tipsBalance : "加入队伍后开始累积" }}
                <template v-if="tipsHasTeam && tipsToday">
                  （今日已累积 {{ tipsToday.accrued }}/{{ tipsToday.cap }}）
                </template>
                · 待报价 {{ hintPendingCount }}/1
              </p>

              <!-- 还没有进行中的请求：填问题 -->
              <template v-if="!activeHint">
                <textarea
                  id="hint-question"
                  v-model="hintQuestion"
                  class="mail-editor hint-question"
                  rows="6"
                  maxlength="2000"
                  placeholder="描述卡住的地方（1–2000 字），官方会据此报价"
                ></textarea>
                <p v-if="!tipsHasTeam" class="helper-text">
                  加入队伍后才能求提示。
                </p>
                <p v-else-if="hintQuotaFull" class="helper-text">
                  已有一条待报价的求提示（每队同时只能 1 条），等官方报价或先关闭它。
                </p>
              </template>

              <!-- 进行中：问题只读 + 状态机 -->
              <template v-else>
                <div class="hint-card">
                  <p class="hint-card__label">
                    我的问题（#{{ activeHint.id }}）
                  </p>
                  <p class="hint-card__question">{{ activeHint.question }}</p>
                </div>

                <p v-if="hintStatus === 'pending'" class="helper-text">
                  等待官方报价…（已等待 {{ waitedText(activeHint.createdAt) }}）
                </p>

                <template v-else-if="hintStatus === 'quoted'">
                  <p class="helper-text">
                    官方报价：<strong>{{ activeHint.quotedCost }}</strong> 点（确认后才扣费）
                  </p>
                  <p v-if="cheaperPending" class="helper-text">
                    已申请更便宜，等待官方回应；期间也可以直接按当前价确认。
                  </p>
                  <p v-else-if="activeHint.isLowestPrice" class="helper-text">
                    官方已表示这就是最低报价。
                  </p>
                  <p v-else-if="activeHint.cheaperDecidedAt" class="helper-text">
                    官方已回应你的降价申请，当前报价即最新价格。
                  </p>
                </template>

                <p v-else-if="hintStatus === 'answered'" class="helper-text">
                  已确认扣费，答复已发到「队伍会话」，可在收件箱查看。
                </p>
                <p v-else-if="hintStatus === 'rejected'" class="helper-text">
                  官方拒绝了这条求提示{{ activeHint.reason ? `：${activeHint.reason}` : "。" }}（未扣费）
                </p>
                <p v-else-if="hintStatus === 'closed'" class="helper-text">
                  这条求提示已关闭。
                </p>
              </template>
            </div>

            <div class="composer__footer">
              <button class="soft-btn" type="button" @click="openHintHistory">
                提示记录
              </button>

              <template v-if="activeHint">
                <button
                  v-if="hintStatus === 'answered' || hintStatus === 'rejected' || hintStatus === 'closed'"
                  class="soft-btn"
                  type="button"
                  @click="startNewHint"
                >
                  再提一条
                </button>
                <button
                  v-if="hintStatus === 'pending' || hintStatus === 'quoted'"
                  class="soft-btn"
                  type="button"
                  :disabled="Boolean(hintActing)"
                  @click="closeActiveHint"
                >
                  {{ hintActing === "close" ? "关闭中..." : "关闭请求" }}
                </button>
                <button
                  v-if="canRequestCheaper"
                  class="soft-btn"
                  type="button"
                  :disabled="Boolean(hintActing)"
                  @click="requestCheaper"
                >
                  {{ hintActing === "cheaper" ? "申请中..." : "申请更便宜" }}
                </button>
                <button
                  v-if="hintStatus === 'quoted'"
                  class="primary-btn"
                  type="button"
                  :disabled="Boolean(hintActing)"
                  @click="confirmActiveHint"
                >
                  {{
                    hintActing === "confirm"
                      ? "确认中..."
                      : `确认（扣 ${activeHint.quotedCost} 点）`
                  }}
                </button>
              </template>

              <button
                v-else
                class="primary-btn"
                type="button"
                :disabled="
                  hintSubmitting ||
                  !tipsHasTeam ||
                  hintQuotaFull ||
                  !hintQuestion.trim()
                "
                @click="submitHintQuestion"
              >
                {{ hintSubmitting ? "提交中..." : "提交求提示" }}
              </button>
            </div>
          </template>

          <!-- 新邮件 / 回复：正文 + 发送 -->
          <template v-else>
            <div class="toolbar">
              <label class="toolbar-label" for="compose-body">正文</label>
            </div>

            <textarea
              id="compose-body"
              v-model="composeDraft"
              class="mail-editor"
              rows="10"
              maxlength="2000"
              placeholder="请输入正文内容（1–2000 字）"
            ></textarea>

            <div class="composer__footer">
              <button
                class="primary-btn"
                type="button"
                :disabled="composing"
                @click="sendCompose"
              >
                {{
                  composing
                    ? "发送中..."
                    : composeReplyTo
                      ? "发送回复"
                      : "发送"
                }}
              </button>
            </div>
          </template>
        </div>

        <!-- 收信：邮件列表与信件详情 -->
        <div v-else class="inbox-panel">
          <!-- 信件详情：邮件式版式，回复统一走写信页 -->
          <template v-if="activeMailId">
            <header class="message-detail-header">
              <div class="toolbar-group">
                <button class="soft-btn" type="button" @click="closeMail">
                  返回收件箱
                </button>
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="!canReply"
                  :title="canReply ? '转到写信页回复' : replyDisabledReason"
                  @click="replyToActiveMail"
                >
                  回复
                </button>
              </div>
              
            </header>

            <article class="message-detail">
              <h2 class="letter-subject">{{ mail?.subject || "（无主题）" }}</h2>

              <div class="message-detail__meta-group">
                <span class="detail-label">发件人</span>
                <span>{{ mailSender }}</span>
                <span class="detail-label">频道</span>
                <span>{{ mail?.channelName || "—" }}</span>
                <span class="detail-label">来源</span>
                <span>{{ sourceLabel(mail?.source) }}</span>
              </div>

              <div v-if="messagesLoading && !messages.length" class="list-hint">
                正在加载邮件...
              </div>
              <div v-else-if="!messages.length" class="list-hint">
                暂无邮件记录。
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
                    </div>
                    <time class="letter__time">
                      {{ formatTime(message.createdAt, { withYear: true }) }}
                    </time>
                  </header>
                  <p class="letter__body">{{ message.content }}</p>
                </article>
              </div>
            </article>

            <div v-if="mail && !canReply" class="reply-bar">
              <p class="helper-text">{{ readOnlyHint }}</p>
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
                  :disabled="mailsLoading"
                  @click="loadMails()"
                >
                  刷新
                </button>
              </div>
            </header>

            <div class="inbox-list">
              <div class="inbox-row inbox-row--head">
                <span>发件人</span>
                <span>邮件</span>
                <span>最后回复</span>
                <span class="inbox-unread">未读</span>
              </div>

              <p v-if="mailsLoading && !mails.length" class="list-hint">
                正在加载邮件列表...
              </p>
              <p v-else-if="!filteredMails.length" class="list-hint">
                {{ emptyHint }}
              </p>

              <button
                v-for="item in filteredMails"
                :key="item.mailId"
                type="button"
                :class="[
                  'inbox-row',
                  'inbox-row--button',
                  { 'is-unread': item.unread > 0 },
                ]"
                @click="openMail(item.mailId)"
              >
                <span class="inbox-sender" :title="senderRoleLabel(item)">{{
                  senderName(item)
                }}</span>
                <span class="inbox-subject">
                  <strong>{{ item.subject || "（无主题）" }}</strong>
                  <small>
                    {{ sourceLabel(item.source) }} · {{ item.channelName }}
                    <template v-if="item.replyCount">
                      · {{ item.replyCount }} 条回复
                    </template>
                  </small>
                </span>
                <span class="inbox-time">{{
                  formatTime(item.lastReplyAt || item.createdAt)
                }}</span>
                <span class="inbox-unread">
                  <span v-if="item.unread > 0" class="unread-badge">
                    {{ item.unread }}
                  </span>
                  <template v-else>—</template>
                </span>
              </button>

              <button
                v-if="mailsHasMore"
                class="soft-btn inbox-more"
                type="button"
                :disabled="mailsLoading"
                @click="loadMails({ append: true })"
              >
                {{ mailsLoading ? "加载中..." : "加载更早的邮件" }}
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
            <span class="hint-list__cost">{{ hintCostText(item) }}</span>
            <time>{{ formatTime(item.createdAt) }}</time>
            <small class="hint-list__question">{{ item.question }}</small>
            <small v-if="item.cheaperRequestedAt" class="hint-list__tag">
              {{ item.isLowestPrice ? "官方已表示最低报价" : "已申请更便宜" }}
            </small>
            <small v-if="item.reason" class="hint-list__tag">
              拒绝原因：{{ item.reason }}
            </small>
            <div
              v-if="item.status === 'pending' || item.status === 'quoted'"
              class="hint-list__actions"
            >
              <button
                class="soft-btn"
                type="button"
                @click="selectHintRequest(item)"
              >
                {{ item.status === "quoted" ? "去确认" : "查看" }}
              </button>
            </div>
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

    <!-- 确认弹窗：申请更便宜 / 关闭请求（玩家端没有组件库，复用 modal 样式） -->
    <div
      v-if="hintConfirm"
      class="modal-backdrop"
      @click.self="hintConfirm = null"
    >
      <div class="modal-card modal-card--confirm">
        <h2>{{ hintConfirm.title }}</h2>
        <p class="helper-text">{{ hintConfirm.text }}</p>
        <div class="modal-card__footer">
          <button class="soft-btn" type="button" @click="hintConfirm = null">
            取消
          </button>
          <button
            class="primary-btn"
            type="button"
            :disabled="Boolean(hintActing)"
            @click="hintConfirm.run()"
          >
            {{ hintConfirm.confirmText }}
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

/* 求提示的问题输入框：沿用正文编辑器的观感，但可滚动高度更小 */
.hint-question {
  min-height: 120px;
}

/* 进行中的求提示：只读展示问题本身 */
.hint-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.hint-card__label {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.hint-card__question {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 确认弹窗比历史弹窗窄一些 */
.modal-card--confirm {
  width: min(420px, 100%);
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

/* 详情里的频道 / 来源一行 */
.message-detail__meta-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.inbox-more {
  align-self: center;
  margin: 12px 16px;
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
  grid-template-columns: 116px minmax(0, 1fr) 120px 64px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
}

/* 发件人：单行省略，完整名字与角色见 title */
.inbox-sender {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inbox-row.is-unread .inbox-sender {
  color: var(--text);
  font-weight: 600;
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

.hint-list__question {
  color: var(--text) !important;
}

.hint-list__tag {
  color: var(--accent) !important;
}

.hint-list__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
}

.hint-list__id,
.hint-list__cost,
.hint-list time {
  color: var(--text-dim);
}

@media (max-width: 960px) {
  .inbox-row {
    grid-template-columns: 92px minmax(0, 1fr) 88px 48px;
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
