<script setup>
// 站内信中心：对接 /api/msg/mails（邮件式，mistarg.2.0.0 起为「站内邮箱」）。
// 列表支持 收件箱 / 已发送 / 归档 / 全部，可平铺或按线程（threaded）展示；
// 详情按整线程拉取（GET /msg/threads/:rootId）；能否回复由服务端的 canReply（0/1）决定。
// 队伍会话（channel=team）是共享邮箱：本队成员可读可回（受发信开关约束）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useGameState } from "@/composables/useGameState";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { extractErrorMessage } from "@/api/errors";
import StatusMessage from "@/components/StatusMessage.vue";
import { messageApi } from "@/api/message";
import { tipsApi } from "@/api/tips";
import { useAttachments } from "@/composables/useAttachments";
import { useMsgAttachments } from "@/composables/useMsgAttachments";
import AttachmentPicker from "@/components/AttachmentPicker.vue";
import AttachmentGallery from "@/components/AttachmentGallery.vue";
import UserTabs from "@/components/UserTabs.vue";
import { assignEnterIndex } from "@/utils/mailEnterIndex";

const { state, refreshUnreadSummary, refreshTeamTips } = useGameState();

// 处罚门禁（api-11-moderation-mute.md）：禁言只关发信通道，读信与求提示的
// 确认 / 议价 / 关闭都不变；队伍封禁时求提示「提问」也会被拦。
// 这里只做体验层隐藏，服务端仍会校验（403 E_MUTED / E_FORBIDDEN）。
const isMuted = computed(() => Boolean(state.accountStatus?.muted));
const isTeamBanned = computed(
  () => state.accountStatus?.team?.status === 4,
);
// 禁言原因/到期，用于提示条文案
const muteNotice = computed(() => {
  const status = state.accountStatus;
  if (!status?.muted) return "";
  if (status.status !== 3 && !status.team?.muted) return "";
  const reason =
    status.status === 3 ? status.muteReason : status.team?.reason ?? null;
  const until =
    status.status === 3 ? status.muteUntil : status.team?.until ?? null;
  const parts = [];
  if (status.status === 3) {
    parts.push("账号已被禁言");
  } else if (status.team?.muted) {
    parts.push(`队伍「${status.team.teamName || status.team.teamId}」已被禁言`);
  }
  if (reason) parts.push(`原因：${reason}`);
  parts.push(
    until
      ? `至 ${new Date(until).toLocaleString("zh-CN", { hour12: false })} 自动解除`
      : "永久禁言，可提交申诉",
  );
  return parts.join(" · ");
});

// 当前页签：inbox = 收信，compose = 写信。
const activeTab = ref("inbox");
// 邮箱文件夹（api-8 §8.1 box，2026-11-11 起）：inbox 收件箱 / sent 已发送 / archive 归档 / all 全部。
// 默认 inbox —— 自己发出的邮件在 sent，不在 inbox。
const mailboxFilter = ref("inbox");
// 列表筛选：all = 全部，unread = 未读（走 only_unread），read = 已读（前端筛）。
const inboxFilter = ref("all");
// 列表筛选的频道口径："" = 全部频道，否则为 system / account / team。
const channelFilter = ref("");
// 列表筛选的来源口径："" = 全部来源，否则为 source 枚举
//（mail / feedback / hint / announce / warn / system / notice / appeal_*）。
// 2026-11-11 起这是服务端参数，不再由前端过滤已加载的行。
const sourceFilter = ref("");
// 回复状态筛选（api-8 answered）："" = 不限，0 = 只看未回复，1 = 只看已回复。
const answeredFilter = ref("");
// 列表视图（api-8 threaded）：true = 一行一条线程（默认，官方建议），false = 每封一行。
const threadedView = ref(false);
// 批量操作选中的行（值 = 该行的 mailId；线程视图下就是线程根 id）。
const selectedIds = ref([]);

// 写信的收件人标识：写给官方走问题反馈接口，请求提示走提示接口。
const OFFICIAL_TARGET = "official";
const HINT_TARGET = "hint";

// 邮件列表（每次发信一行）与分页游标
const mails = ref([]);
const mailsLoading = ref(false);
const mailsCursor = ref(null);
const mailsHasMore = ref(false);
// 每封邮件的入场序号（按到达批次从 0 起）：追加新批次时只给新邮件编号，旧行保持原有节奏。
const mailsEnterIndex = ref(new Map());
// 列表「实例号」：切分类 / 频道 / 来源时 +1，参与 v-for 的 key。
// Vue 会复用同 key 的 DOM 节点，只有换 key 才会重建节点、让入场动画重头播放。
const mailsListToken = ref(0);
// 列表滚动容器：换实例后行全部重建，需要把滚动位置拉回顶部，否则动画从看不见的地方开始播。
const inboxListRef = ref(null);
const MAILS_PAGE_SIZE = 20;

// 当前打开的邮件对话：activeMailId 是「要看的那一封」，线程按 threadRootId 拉整条。
const activeMailId = ref(null);
const mail = ref(null);
// 整线程的汇总（GET /msg/threads/:rootId 的 thread）+ 线程内邮件（时间升序）
const thread = ref(null);
const threadRootId = ref(null);
const messages = ref([]);
const messagesLoading = ref(false);
// 线程内更早的邮件：hasMore 时用 nextBeforeId 继续取
const threadHasMore = ref(false);
const threadNextBeforeId = ref(null);
// 归档操作进行中（同一时刻只允许一个）
const archiveBusy = ref(false);

// 写信页的收件人、主题、草稿与提交状态。
const composeTarget = ref(OFFICIAL_TARGET);
const composeSubject = ref("");
const composeDraft = ref("");
const composing = ref(false);
// 回复模式：非空表示这是对某封邮件的回复（主题留空时由服务端按层级生成）
const composeReplyTo = ref(null);
// 回复时的可选主题：非空 = 中途改题（服务端原样使用，并开启新的主题基准）
const composeReplySubject = ref("");

// 操作提示的文案与语义色统一交给 useStatusMessage 管理。
const {
  message: notice,
  tone: noticeType,
  set: setNotice,
  clear: clearNotice,
} = useStatusMessage();

// ---------- 图片附件（api-8-message-mail.md §8.3，2026-10-31 起） ----------
// 写信 / 回复 / 问题反馈共用一份，求提示提问自己一份（两处不能混：提交是各走各的接口）。
// 前端不做压缩，选图时即按规格校验（≤3 张、jpg/png/webp、≤5MiB、长边 ≤1600px）；
// 校验通过后立刻 sign + 直传，提交时只带 objectKey，未传完禁止提交。
const composeAttachments = useAttachments({
  onError: (text) => setNotice("error", text),
});
const hintAttachments = useAttachments({
  onError: (text) => setNotice("error", text),
});
// 发信侧的附件开关（/api/msg/policy.attachmentsEnabled，严格判值：缺失即关闭）。
const { attachmentsEnabled, loadPolicy } = useMsgAttachments();

// 模板里用的解构别名（setup 里的顶层 ref 在模板中会自动解包，取 .value 反而读不到）
const {
  items: composeFiles,
  dragging: composeDragging,
  issue: composeIssue,
  busy: composeAttachBusy,
  addFiles: addComposeFiles,
  remove: removeCompose,
  retry: retryCompose,
  onPaste: onComposePaste,
  onDragenter: onComposeDragenter,
  onDragover: onComposeDragover,
  onDragleave: onComposeDragleave,
  onDrop: onComposeDrop,
} = composeAttachments;
const {
  items: hintFiles,
  dragging: hintDragging,
  issue: hintIssue,
  busy: hintAttachBusy,
  addFiles: addHintFiles,
  remove: removeHint,
  retry: retryHint,
  onPaste: onHintPaste,
  onDragenter: onHintDragenter,
  onDragover: onHintDragover,
  onDragleave: onHintDragleave,
  onDrop: onHintDrop,
} = hintAttachments;

// 附件开关关闭时（后端 attachmentsEnabled=false，此时 sign 会回 403 MSG_IMAGE_DISABLED）
// 连事件都不绑：否则粘贴一张图就会造出一条「上传失败」的附件，
// failed 卡住提交，而选图入口是隐藏的 —— 用户没有「移除」可点，只能刷新页面。
// 用 v-on 对象而不是逐个加条件，新增入口时不会漏掉。
const composeAttachEvents = computed(() =>
  attachmentsEnabled.value
    ? {
        paste: onComposePaste,
        dragenter: onComposeDragenter,
        dragover: onComposeDragover,
        dragleave: onComposeDragleave,
        drop: onComposeDrop,
      }
    : {},
);
const hintAttachEvents = computed(() =>
  attachmentsEnabled.value
    ? {
        paste: onHintPaste,
        dragenter: onHintDragenter,
        dragover: onHintDragover,
        dragleave: onHintDragleave,
        drop: onHintDrop,
      }
    : {},
);
// 开关关闭时不再提「可拖拽或粘贴截图」
const composePlaceholder = computed(() =>
  attachmentsEnabled.value
    ? "请输入正文内容（1–2000 字）；可拖拽或粘贴截图"
    : "请输入正文内容（1–2000 字）",
);
const hintQuestionPlaceholder = computed(() => {
  const base = "描述卡住的地方（1–2000 字），官方会据此报价";
  return attachmentsEnabled.value ? `${base}；可拖拽或粘贴截图` : base;
});

// 求提示：进行中的请求可能有多条 —— 只有 pending 占用「每队 1 条」名额，
// 一旦官方报价（quoted）就释放名额，所以可以有 1 条 pending + 多条待确认/待议价的请求。
// 每条请求各自带 quotedCost，确认时按各自的价格扣费。
const hintQuestion = ref("");
const hintSubmitting = ref(false);
// 正在执行的动作用途（`${id}:confirm|cheaper|close`），逐条禁用按钮防重复提交
const hintActing = ref("");
// 进行中的请求（pending / quoted），按 id 倒序
const openHints = ref([]);
// 从「提示记录」里跳转过来时高亮的那条
const focusedHintId = ref(null);
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

// 本队点数流水（GET /api/tips/ledger）：与提示记录并列，从求提示面板打开。
// 余额与流水都以服务端为准，不在本地推算。
const ledgerOpen = ref(false);
const ledgerItems = ref([]);
const ledgerLoading = ref(false);
const ledgerNextCursor = ref(null);
const ledgerTeamId = ref(null);

const LEDGER_REASON_LABELS = {
  accrue: "自然增长",
  puzzle: "解题奖励",
  milestone: "里程碑奖励",
  admin: "管理端发放/扣减",
  spend: "点数消费",
  hint: "求提示扣费",
  refund: "退款",
};

function ledgerReasonLabel(reason) {
  return LEDGER_REASON_LABELS[reason] || reason || "—";
}

function ledgerDeltaText(delta) {
  const value = Number(delta) || 0;
  return value > 0 ? `+${value}` : String(value);
}

// 提问后每 10 秒查一次报价，直到不再是 pending；申请更便宜等官方回应期间同样要盯着。
const HINT_POLL_MS = 10000;
let hintTimer = null;

const isLoggedIn = computed(() => Boolean(state.user.currentUser));
// 详情里的根邮件摘要（服务端归一后的 mail）
// 玩家可回复的邮件：服务端的 canReply（0/1，官方公告类为 0）；
// 2026-11-11 起队伍会话是可回复的共享邮箱（回复发送给全队），不再按频道禁用。
// 禁言期间发信接口一律 E_MUTED，所以直接禁掉回复入口。
const canReply = computed(
  () => Number(mail.value?.canReply) === 1 && !isMuted.value,
);
// 不可回复时的按钮提示与说明文案
const replyDisabledReason = computed(() => {
  if (isMuted.value) return "禁言期间不能发信";
  return "这封邮件不可回复";
});
const readOnlyHint = computed(() => {
  if (isMuted.value) {
    return "禁言期间不能发信（含问题反馈与求提示提问），可在「我的申诉」查看与提交申诉。";
  }
  return "这封邮件不可回复（如官方公告）；如需联系工作人员，请使用「写信」。";
});
// 写信收件人选择「请求提示」时，撰写页显示求提示面板。
// 必须同时满足：当前就在写信页、不是回复、收件人选的是「请求提示」。
// 只看 composeTarget 的话，选了求提示再切回收信或去回复邮件时它仍是 "hint"：
// 回复模式下收件人下拉已隐藏，正文区却被求提示面板顶替，邮件根本回不了；
// 而且 hintPollingWanted 会跟着一直为 true，回到收信后仍在轮询提示历史。
const isHintCompose = computed(
  () =>
    activeTab.value === "compose" &&
    !composeReplyTo.value &&
    composeTarget.value === HINT_TARGET,
);

// ---------- 求提示的派生状态（口径见 api-10 §10.12） ----------

// 待报价名额已占满（每队上限 1；quoted 不占名额，所以仍可继续提问）
const hintQuotaFull = computed(() => hintPendingCount.value >= 1);

// 进行中的请求 = pending / quoted
const isOpenHint = (item) =>
  item?.status === "pending" || item?.status === "quoted";

// 可申请更便宜：已报价、没申请过、官方也没表示过是最低价（逐条判断）
const canRequestCheaperOf = (item) =>
  item?.status === "quoted" &&
  !item.cheaperRequestedAt &&
  !item.isLowestPrice;

// 已申请更便宜、官方还没回应（逐条判断）
const cheaperPendingOf = (item) =>
  Boolean(item?.cheaperRequestedAt) && !item?.cheaperDecidedAt;

// 某条请求的某个动作是否正在执行
const hintBusyOf = (item, action) =>
  hintActing.value === `${item.id}:${action}`;

// 需要轮询：求提示面板打开着，或提示记录弹窗打开着 —— 用「请求历史」拿服务端权威状态
// （只有当前这一条的状态不够：官方可能在你没盯着时报价、拒绝、或回应降价）。
const hintPollingWanted = computed(
  () => isHintCompose.value || hintHistoryOpen.value,
);
// 回复模式下的主题预览：留空由服务端按层级生成（层级 ≥5 会收缩成「回复*N：」），
// 填了就是中途改题（服务端原样使用并开启新的主题基准）。
const replySubjectPlaceholder = computed(() =>
  mail.value?.subject
    ? `留空自动生成：回复：${mail.value.subject}`
    : "留空自动生成回复主题",
);

// 详情抬头发件人 = 当前打开这封的发送者（from）。
const mailSender = computed(() => (mail.value ? senderName(mail.value) : "—"));

// 线程视图下行代表整条线程：未读/封数取线程汇总；平铺视图取这一封自己的值。
// （放在 matchesMailFilter 之前：筛选也要用同一个未读口径。）
const rowUnread = (item) =>
  Number(
    (threadedView.value ? item?.thread?.unreadCount : null) ??
      item?.unread ??
      0,
  ) || 0;
const rowMessageCount = (item) => Number(item?.thread?.messageCount ?? 0) || 0;

// 线程行的发件人来自 thread.from（线程最新一封），平铺行就是这一封自己的 from。
const rowSenderSource = (item) =>
  threadedView.value && item?.thread?.from ? { from: item.thread.from } : item;
const rowSender = (item) => senderName(rowSenderSource(item));
const rowSenderTitle = (item) => senderRoleLabel(rowSenderSource(item));

// 列表筛选：「未读」交给服务端（only_unread），「已读」只能在前端分类；
// 来源 / 频道已经是服务端参数，不再在这里筛。
//
// 这条判定必须只有一份实现：loadMails() 也要用它来给「将要显示的行」编号，
// 否则入场序号的顺序会和实际渲染顺序对不上（见下方 enterIndex 的注释）。
function matchesMailFilter(item) {
  if (inboxFilter.value === "read" && rowUnread(item) > 0) {
    return false;
  }
  return true;
}

const filteredMails = computed(() => mails.value.filter(matchesMailFilter));

// ---------- 批量选择（api-8 §8.6 / §8.7） ----------
const BATCH_LIMIT = 100;
const batchBusy = ref("");
const isSelected = (item) => selectedIds.value.includes(item.mailId);
const selectedCount = computed(() => selectedIds.value.length);
const allFilteredSelected = computed(
  () =>
    filteredMails.value.length > 0 &&
    filteredMails.value.every((item) => selectedIds.value.includes(item.mailId)),
);

function toggleSelect(mailId) {
  selectedIds.value = selectedIds.value.includes(mailId)
    ? selectedIds.value.filter((id) => id !== mailId)
    : [...selectedIds.value, mailId];
}

function toggleSelectAll() {
  selectedIds.value = allFilteredSelected.value
    ? []
    : filteredMails.value.slice(0, BATCH_LIMIT).map((item) => item.mailId);
}

function clearSelection() {
  selectedIds.value = [];
}

function selectedRows() {
  const ids = new Set(selectedIds.value);
  return filteredMails.value
    .filter((item) => ids.has(item.mailId))
    .slice(0, BATCH_LIMIT);
}

// 批量已读 / 归档：一次请求传全部 id（`ids` 上限 100，§8.6 / §8.7）。
// 线程视图下勾选行的 mailId 就是线程根 id，服务端按 id 处理归属，不需要逐条发。
async function runBatch(action) {
  const rows = selectedRows();
  if (!rows.length || batchBusy.value) {
    return;
  }

  const ids = rows.map((row) => row.mailId);
  batchBusy.value = action;
  try {
    if (action === "read") {
      await messageApi.markReadBatch({ ids });
    } else {
      await messageApi.archiveMails({
        ids,
        archived: action === "archive",
      });
    }

    const selected = new Set(ids);
    for (const item of mails.value) {
      if (!selected.has(item.mailId)) continue;
      if (action === "read") {
        item.unread = 0;
        if (item.thread) {
          item.thread = { ...item.thread, unreadCount: 0 };
        }
      } else {
        item.archived = action === "archive" ? 1 : 0;
      }
    }

    setNotice(
      "success",
      action === "read"
        ? "已标记为已读。"
        : action === "archive"
          ? "已归档，可在「归档」文件夹找回。"
          : "已取消归档。",
    );
    selectedIds.value = [];
    await Promise.all([loadMails(), refreshUnreadSummary()]);
  } catch (error) {
    setNotice("error", errorText(error, "批量操作失败。"));
  } finally {
    batchBusy.value = "";
  }
}

// 「全部已读」：{ all: true } 标记当前可见的全部未读（服务端只动非本人发送的邮件）。
async function markAllRead() {
  if (batchBusy.value) {
    return;
  }

  batchBusy.value = "all-read";
  try {
    const response = await messageApi.markReadBatch({ all: true });
    const marked = Number(response?.data?.marked ?? 0) || 0;
    setNotice(
      "success",
      marked ? `已把 ${marked} 封标记为已读。` : "没有需要标记的未读。",
    );
    await Promise.all([loadMails(), refreshUnreadSummary()]);
  } catch (error) {
    setNotice("error", errorText(error, "全部已读失败。"));
  } finally {
    batchBusy.value = "";
  }
}

// 空列表提示：已读是客户端筛选，可能只是把已加载的记录都滤掉了。
const emptyHint = computed(() =>
  inboxFilter.value === "read"
    ? "已加载的邮件中没有符合条件的记录；可点「加载更早的邮件」继续查找。"
    : "暂无邮件记录。",
);

// 邮件行的入场序号：同一批新邮件从 0 逐封错开，翻页追加不会因下标变大而挤在一起。
function rowEnterIndex(item) {
  return mailsEnterIndex.value.get(item.mailId) ?? 0;
}

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
  // 官方通知（管理端 /msg/notify 发送）
  notice: "官方通知",
  // 处罚申诉链：解禁 / 解封后这些邮件会照常出现在收件箱
  appeal_ban: "封禁申诉",
  appeal_mute: "禁言申诉",
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

// 邮箱文件夹（api-8 §8.1 box）：收件箱 / 已发送 / 归档 / 全部。
const MAILBOX_VIEWS = [
  { value: "inbox", label: "收件箱" },
  { value: "sent", label: "已发送" },
  { value: "archive", label: "归档" },
  { value: "all", label: "全部邮件" },
];

// 当前文件夹内的筛选：全部 / 未读（only_unread）/ 已读（前端筛）。
const INBOX_VIEWS = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "read", label: "已读" },
];

// 回复状态（GET /msg/mails 的 answered 参数）
const ANSWERED_VIEWS = [
  { value: "", label: "回复状态" },
  { value: "0", label: "未回复" },
  { value: "1", label: "已回复" },
];

// 列表视图（GET /msg/mails 的 threaded 参数）
const THREADED_VIEWS = [
  { value: "1", label: "按线程" },
  { value: "0", label: "按邮件" },
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
// 2026-11-11 起列表接口支持 source 参数，选它就是换一次请求。
const SOURCE_VIEWS = [
  { value: "", label: "全部来源" },
  ...Object.keys(SOURCE_LABEL).map((value) => ({
    value,
    label: SOURCE_LABEL[value],
  })),
];

// 左侧功能列当前选中项：写信，或当前邮箱文件夹。
const activeView = computed(() =>
  activeTab.value === "compose" ? "compose" : mailboxFilter.value,
);

// 右侧列表工具栏上的当前位置：只显示文件夹名，筛选 / 频道 / 来源已经在工具栏的下拉里。
const currentFolderLabel = computed(
  () =>
    MAILBOX_VIEWS.find((item) => item.value === mailboxFilter.value)?.label ??
    "收件箱",
);

// 切换左侧功能列：选写信直接换成撰写页；选文件夹则回到列表（已打开的邮件先关闭）。
function switchView(view) {
  clearNotice();

  if (view === "compose") {
    activeTab.value = "compose";
    return;
  }

  const changed = mailboxFilter.value !== view;
  const fromCompose = activeTab.value === "compose";
  activeTab.value = "inbox";
  mailboxFilter.value = view;
  composeReplyTo.value = null;

  // 换文件夹重新拉最新一页（append = false）：分页游标归 0，
  // 「加载更早的邮件」按钮与是否还有更早邮件都以这次响应为准；
  // 已加载的行不清空，避免切换瞬间列表闪成空白。
  // replay = true：拿到新数据时重建所有行，入场动画重头播放。
  if (activeMailId.value) {
    closeMail(); // 内部已经会重取列表（关详情本身就会重建行，无需额外 replay）
  } else if (changed || fromCompose) {
    loadMails({ replay: true });
  }
}

// 切换「全部 / 未读 / 已读」：只动筛选，不动文件夹。
function switchInboxFilter(view) {
  clearNotice();
  const changed = inboxFilter.value !== view;
  const fromCompose = activeTab.value === "compose";
  activeTab.value = "inbox";
  inboxFilter.value = view;
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  } else if (changed || fromCompose) {
    loadMails({ replay: true });
  }
}

// 切换来源：服务端参数，重新拉最新一页（已加载的其它来源的行不能留着）。
function switchSource(source) {
  clearNotice();
  const changed = sourceFilter.value !== source;
  const fromCompose = activeTab.value === "compose";
  activeTab.value = "inbox";
  sourceFilter.value = source;
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  } else if (changed || fromCompose) {
    loadMails({ replay: true });
  }
}

// 切换回复状态筛选（answered=0/1）。
function switchAnswered(value) {
  clearNotice();
  const changed = answeredFilter.value !== value;
  activeTab.value = "inbox";
  answeredFilter.value = value;
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  } else if (changed) {
    loadMails({ replay: true });
  }
}

// 切换列表视图（按线程 / 按邮件）：游标形状不同，必须整批重拉。
function switchThreaded(value) {
  const next = String(value) === "1";
  if (next === threadedView.value) {
    return;
  }
  clearNotice();
  threadedView.value = next;
  activeTab.value = "inbox";
  composeReplyTo.value = null;

  if (activeMailId.value) {
    closeMail();
  } else {
    loadMails({ replay: true });
  }
}

// 左侧「写信」：清掉回复上下文，写一封新邮件。
// 禁言期间发信接口一律 403 E_MUTED，入口已在界面上隐藏，这里再兜一层。
function startNewMail() {
  if (isMuted.value) {
    setNotice("error", "禁言期间不能发信，可在「我的申诉」查看与提交申诉。");
    return;
  }
  composeReplyTo.value = null;
  composeReplySubject.value = "";
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
    loadMails({ replay: true });
  }
}

// ---------- 邮件列表 ----------

// 列表请求代号：切频道 / 切未读筛选、关闭详情后的刷新、可见性补刷、加载更多都可能重叠。
// 只接受最新一次请求的结果——否则旧频道的慢响应会覆盖新筛选的行与游标，
// 旧的 append 还会把别的频道的数据追加到当前列表后面。
let mailsRequestGeneration = 0;

async function loadMails({ append = false, replay = false } = {}) {
  if (!isLoggedIn.value) {
    return;
  }

  const requestId = ++mailsRequestGeneration;
  mailsLoading.value = true;

  // 切分类 / 频道 / 来源：先把已加载的邮件整批清空。
  // 紧接着一定会重新拉最新一页，留着上一个 tab 的数据既没有意义，
  // 也会让行动画「先拿旧数据播一遍、再被新数据替换」。
  // 清空后列表只显示「正在加载邮件列表…」，等响应回来再整体挂载一遍。
  if (!append && replay) {
    mailsListToken.value += 1;
    mails.value = [];
    mailsEnterIndex.value = new Map();
    mailsCursor.value = null;
    mailsHasMore.value = false;
    // 换视图 / 换筛选后旧的勾选没有意义
    selectedIds.value = [];
    // 行重建后容器仍保留旧滚动位置，动画会从看不见的顶部开始播
    if (inboxListRef.value) inboxListRef.value.scrollTop = 0;
  }

  try {
    const response = await messageApi.getMails({
      cursor: append ? (mailsCursor.value ?? 0) : 0,
      limit: MAILS_PAGE_SIZE,
      // 文件夹（默认收件箱）、频道、来源、回复状态都交给服务端过滤
      box: mailboxFilter.value || undefined,
      channel: channelFilter.value || undefined,
      source: sourceFilter.value || undefined,
      answered:
        answeredFilter.value === "" ? undefined : Number(answeredFilter.value),
      threaded: threadedView.value ? 1 : undefined,
      // 「未读」交给服务端过滤
      onlyUnread: inboxFilter.value === "unread",
    });
    // 期间又发起了新请求（换了筛选 / 又点了一次加载更多）：本次结果整体作废
    if (requestId !== mailsRequestGeneration) {
      return;
    }

    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];

    // 入场序号必须按「最终会显示出来的顺序」编号，而不是按接口返回的原始顺序。
    // 「已读」与「来源」是前端分类：接口一页 20 封里可能只有 3 封符合条件，
    // 若照原始下标编号，渲染出来的 3 行会拿到被打散的序号（如 0 / 7 / 13），
    // animation-delay 就会拉出空洞、看起来像「先挂载再筛掉」。
    // 先筛、再按 0,1,2… 连续编号，挂载出来的错峰才是连贯的。
    mailsEnterIndex.value = assignEnterIndex(
      append ? mailsEnterIndex.value : null,
      items,
      matchesMailFilter,
    );

    mails.value = append ? [...mails.value, ...items] : items;
    mailsCursor.value = data.nextCursor ?? null;
    mailsHasMore.value = Boolean(data.hasMore);
  } catch (error) {
    // 过期请求的错误同样不提示，避免旧筛选的失败盖住当前页面的正常状态
    if (requestId !== mailsRequestGeneration) {
      return;
    }
    setNotice("error", errorText(error, "加载邮件列表失败。"));
  } finally {
    // loading 归最新一次请求管，旧请求不要替它关掉
    if (requestId === mailsRequestGeneration) {
      mailsLoading.value = false;
    }
  }
}

// ---------- 增量拉新（since_id，api-8 §8.1） ----------

// 列表里已知的最新 mailId（since_id 的基准）。
function newestLoadedMailId() {
  let newest = 0;
  for (const item of mails.value) {
    const id = Number(item.mailId) || 0;
    if (id > newest) newest = id;
  }
  return newest;
}

// 拉取比已知最新 id 更大的邮件（服务端按 id 正序返回、忽略 cursor），反转后插到列表最前面。
// 约束：since_id 不能与 threaded=1 同用（会 400 E_VALIDATION）——线程视图交给整页刷新。
// 返回 true 表示这次增量请求成功发出（即使没有新邮件），false 表示本次跳过、需要整页刷新。
async function loadNewMails() {
  const sinceId = newestLoadedMailId();
  if (
    !isLoggedIn.value ||
    activeTab.value === "compose" ||
    threadedView.value ||
    !sinceId ||
    mailsLoading.value
  ) {
    return false;
  }

  const requestId = ++mailsRequestGeneration;
  try {
    const response = await messageApi.getMails({
      sinceId,
      limit: MAILS_PAGE_SIZE,
      // 与整页加载用同一套服务端筛选，不然新邮件会越过当前筛选条件冒出来
      box: mailboxFilter.value || undefined,
      channel: channelFilter.value || undefined,
      source: sourceFilter.value || undefined,
      answered:
        answeredFilter.value === "" ? undefined : Number(answeredFilter.value),
      onlyUnread: inboxFilter.value === "unread",
    });
    if (requestId !== mailsRequestGeneration) {
      return true;
    }

    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      return true;
    }

    // since_id 模式是「旧 → 新」，列表是倒序：反转后去掉已有行，再放到最前面
    const known = new Set(mails.value.map((item) => Number(item.mailId)));
    const fresh = [...items]
      .reverse()
      .filter((item) => !known.has(Number(item.mailId)));
    if (!fresh.length) {
      return true;
    }

    mailsEnterIndex.value = assignEnterIndex(
      mailsEnterIndex.value,
      fresh,
      matchesMailFilter,
    );
    mails.value = [...fresh, ...mails.value];
    setNotice("success", `收到 ${fresh.length} 封新邮件。`);
    void refreshUnreadSummary();
    return true;
  } catch {
    // 增量失败静默：列表还在，手动「刷新」可用
    return false;
  }
}

// 列表页轮询：页面可见、在列表（不是详情 / 写信）时才做增量拉新。
// 线程视图下 loadNewMails 直接跳过（since_id 与 threaded 互斥），
// 也不做整页重拉——每分钟重建整个列表会打断阅读，切回页面时再对齐即可。
const MAIL_POLL_MS = 60000;
let mailTimer = null;

function startMailPolling() {
  if (mailTimer !== null) {
    return;
  }
  mailTimer = window.setInterval(() => {
    if (document.hidden || activeMailId.value) {
      return;
    }
    void loadNewMails();
  }, MAIL_POLL_MS);
}

function stopMailPolling() {
  if (mailTimer !== null) {
    window.clearInterval(mailTimer);
    mailTimer = null;
  }
}

// ---------- 邮件详情（整线程） ----------

// 详情请求代号：打开 A 还没回来就切到 B（或直接关闭）时，A 的响应不能再写内容 / 报错 / 关 loading。
let detailRequestGeneration = 0;

// 列表行 → 线程根 id：平铺行的 rootMsgId（根邮件为 null）、线程行的 rootMailId、兜底自身。
function rootIdOf(row) {
  return row?.rootMsgId ?? row?.rootMailId ?? row?.mailId ?? null;
}

function isCurrentThread(rootId, requestId) {
  return requestId === detailRequestGeneration && rootId === threadRootId.value;
}

// 打开一封邮件：先定位它所在的线程根，再按「整线程」拉内容（含后续回复与分支）。
// rootId 能由列表行给出时就省掉一次 getMail。
async function openMail(mailId, rootId = null) {
  activeMailId.value = mailId;
  mail.value = null;
  messages.value = [];
  thread.value = null;
  threadHasMore.value = false;
  threadNextBeforeId.value = null;
  clearNotice();

  const root = rootId ?? (await resolveRootId(mailId));
  if (!root) {
    return;
  }
  // 只有这次选择仍然有效时才继续标记已读（见下方 markThreadRead 的守卫）
  const loaded = await loadThread(root, mailId);
  if (!loaded) {
    return;
  }
  await markThreadRead(root);
}

// 手里没有线程根时：取这一封的详情，用 rootMsgId（根邮件为空）换算成根 id。
async function resolveRootId(mailId) {
  try {
    const response = await messageApi.getMail(mailId);
    const data = response?.data ?? {};
    return data?.mail?.rootMsgId ?? data?.mail?.mailId ?? mailId;
  } catch {
    // 详情失败就让线程接口去报错（404/403 的文案更准确）
    return mailId;
  }
}

// 关闭邮件详情，回到收信列表；顺带刷新未读角标。
function closeMail() {
  // 作废在途的详情请求：关掉详情后迟到的响应不能再把 mail / messages 填回去
  detailRequestGeneration += 1;
  messagesLoading.value = false;
  activeMailId.value = null;
  mail.value = null;
  thread.value = null;
  threadRootId.value = null;
  messages.value = [];
  threadHasMore.value = false;
  threadNextBeforeId.value = null;
  // 回到列表相当于重新开始一轮浏览：旧的勾选不再有意义
  selectedIds.value = [];
  refreshUnreadSummary();
  loadMails();
}

// 整线程：GET /msg/threads/:rootId（messages 时间升序）。
// focusMailId 是「用户点开的那一封」，用来定位详情抬头；找不到就退回线程最新一封。
// beforeId > 0 时取更早一页并插到前面。
async function loadThread(
  rootId,
  focusMailId = null,
  { beforeId = 0, append = false } = {},
) {
  if (!rootId) {
    return false;
  }

  const requestId = ++detailRequestGeneration;
  threadRootId.value = rootId;
  messagesLoading.value = true;
  try {
    const response = await messageApi.getThread(rootId, {
      beforeId: beforeId || undefined,
    });
    // 期间已经切到别的线程（或关掉了详情）：本次响应整体作废
    if (!isCurrentThread(rootId, requestId)) {
      return false;
    }

    const data = response?.data ?? {};
    thread.value = data.thread ?? null;
    const items = Array.isArray(data.messages) ? data.messages : [];
    messages.value = append ? [...items, ...messages.value] : items;
    threadHasMore.value = Boolean(data.hasMore);
    threadNextBeforeId.value = data.nextBeforeId ?? null;

    const focused =
      (focusMailId &&
        messages.value.find((item) => item.mailId === focusMailId)) ||
      messages.value[messages.value.length - 1] ||
      null;
    mail.value = focused;
    if (focused) {
      activeMailId.value = focused.mailId;
    }
    return true;
  } catch (error) {
    // 过期请求的错误同样不提示：那是上一封邮件的事
    if (!isCurrentThread(rootId, requestId)) {
      return false;
    }
    setNotice("error", errorText(error, "加载邮件内容失败。"));
    return false;
  } finally {
    // loading 归最新一次请求管
    if (requestId === detailRequestGeneration) {
      messagesLoading.value = false;
    }
  }
}

// 加载线程里更早的邮件（before_id 分页）。
async function loadEarlierMessages() {
  const rootId = threadRootId.value;
  const beforeId = threadNextBeforeId.value;
  if (!rootId || !beforeId || messagesLoading.value) {
    return;
  }
  await loadThread(rootId, mail.value?.mailId ?? null, {
    beforeId,
    append: true,
  });
}

// 线程级已读（POST /msg/mails/read { root_id }）：打开即清掉整条线程未读，
// 比逐封标记省请求，也与「整线程视图」的口径一致。
async function markThreadRead(rootId) {
  if (!rootId || Number(thread.value?.unreadCount ?? 0) <= 0) {
    return;
  }

  try {
    await messageApi.markReadBatch({ rootId });
    // 标记期间可能已切走：只清这条线程自己的标记
    if (threadRootId.value !== rootId) {
      return;
    }
    thread.value = { ...(thread.value ?? {}), unreadCount: 0 };
    for (const message of messages.value) {
      message.unread = 0;
    }
    for (const item of mails.value) {
      if (rootIdOf(item) === rootId) {
        item.unread = 0;
        if (item.thread) {
          item.thread = { ...item.thread, unreadCount: 0 };
        }
      }
    }
    refreshUnreadSummary();
  } catch (error) {
    if (threadRootId.value !== rootId) {
      return;
    }
    setNotice("error", errorText(error, "标记已读失败。"));
  }
}

// 归档 / 取消归档：整条线程（root_id）。归档不改变已读状态，只是移出收件箱。
// 归档文件夹里的邮件一律视为「已归档」（按钮就是取消归档），收件箱 / 已发送反之。
const threadArchived = computed(
  () => Number(mail.value?.archived) === 1 || mailboxFilter.value === "archive",
);

async function toggleThreadArchive() {
  const rootId = threadRootId.value;
  if (!rootId || archiveBusy.value) {
    return;
  }

  const next = !threadArchived.value;
  archiveBusy.value = true;
  try {
    await messageApi.archiveMails({ rootId, archived: next });
    for (const message of messages.value) {
      message.archived = next ? 1 : 0;
    }
    if (mail.value) {
      mail.value = { ...mail.value, archived: next ? 1 : 0 };
    }
    setNotice(
      "success",
      next ? "已归档，可在「归档」文件夹找回。" : "已取消归档，邮件回到原文件夹。",
    );
    await loadThread(rootId, mail.value?.mailId ?? null);
    await Promise.all([loadMails(), refreshUnreadSummary()]);
  } catch (error) {
    setNotice("error", errorText(error, next ? "归档失败。" : "取消归档失败。"));
  } finally {
    archiveBusy.value = false;
  }
}

// ---------- 可见性刷新 ----------

// 页面重新可见时补刷：详情打开则重拉这封邮件（未读/内容可能已变），否则刷新列表；
// 同时刷新正在等报价的求提示。
async function handleVisibilityChange() {
  if (document.hidden) {
    return;
  }

  if (activeMailId.value) {
    // 抓住发起时的线程根与目标邮件：await 期间用户可能已经切走。
    // 这次刷新会顶掉「点开邮件」那次加载，因此「标记已读」的责任要由这里接过来，
    // 否则打开未读邮件时刚好回到前台，邮件显示了却一直停在未读。
    const rootId = threadRootId.value;
    const mailId = activeMailId.value;
    if (rootId) {
      const loaded = await loadThread(rootId, mailId);
      // loaded=false 表示又被更新的请求接管了，标记权继续往后传，不能在这里擅自标
      if (loaded) {
        await markThreadRead(rootId);
      }
    }
  } else if (!(await loadNewMails())) {
    // 线程视图 / 没有已知 id / 增量失败：退回整页刷新
    loadMails();
  }

  if (hintPollingWanted.value) {
    refreshHintSnapshot();
  }
}

// ---------- 回复邮件：跳转到写信页 ----------

// 邮件详情页不直接输入：点「回复」切到写信页，回复线程里最新的一封（保持单链，不出分支）；
// 主题留空 = 服务端按层级生成「回复：…」，填了就是中途改题。canReply=false（公告类）时按钮已禁用。
function replyToActiveMail() {
  if (!mail.value || !canReply.value) {
    return;
  }

  const latest = messages.value[messages.value.length - 1] ?? mail.value;
  composeReplyTo.value = latest.mailId;
  composeReplySubject.value = "";
  switchView("compose");
}

// ---------- 写信 ----------

// 写信提交：回复走发信接口（不传主题，服务端生成）；新邮件走问题反馈接口。
// 两者在禁言期间都是 403 E_MUTED（api-11 §二「影响范围」），入口已隐藏，这里兜底并给出原因。
async function sendCompose() {
  if (composing.value) {
    return;
  }

  if (isMuted.value) {
    setNotice("error", "禁言期间不能发信，可在「我的申诉」查看与提交申诉。");
    return;
  }

  const content = composeDraft.value.trim();
  if (!content) {
    setNotice("error", "正文不能为空。");
    return;
  }
  // 图片是补充：正文仍必填；但上传没完成时不能提交（提交只带 objectKey）
  if (composeAttachments.uploading.value) {
    setNotice("error", "图片还在上传，请等上传完成后再发送。");
    return;
  }
  if (composeAttachments.failed.value) {
    setNotice("error", "有图片上传失败，请重试或移除后再发送。");
    return;
  }

  const attachments = composeAttachments.serialize();
  composing.value = true;
  setNotice("pending", "正在发送...");
  try {
    if (composeReplyTo.value) {
      const replyTo = composeReplyTo.value;
      const subject = composeReplySubject.value.trim();
      const response = await messageApi.sendMail({
        replyTo,
        // 非空 = 中途改题；留空时服务端按父主题生成「回复：…」
        ...(subject ? { subject } : {}),
        content,
        attachments,
      });
      const data = response?.data ?? {};
      const newMailId = data.mailId ?? replyTo;
      // 整线程视图：回复后按线程根重新拉，直接定位到刚发出的那封
      const rootId = data.rootMsgId ?? threadRootId.value ?? replyTo;

      composeDraft.value = "";
      composeReplyTo.value = null;
      composeReplySubject.value = "";
      composeAttachments.clear();
      activeTab.value = "inbox";
      await loadMails();
      await openMail(newMailId, rootId);
      setNotice("success", "回复已发出。");
    } else {
      // 主题可选：留空时服务端取正文首行
      const subject = composeSubject.value.trim();
      await messageApi.feedback({
        subject: subject || undefined,
        content,
        attachments,
      });
      setNotice(
        "success",
        "已发送给官方 / 工作人员，回复会出现在「与官方的联系」中。",
      );

      composeDraft.value = "";
      composeSubject.value = "";
      composeAttachments.clear();
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

// 把「请求历史」里的条目同步到进行中列表，并在状态真正变化时提示 / 刷新相关数据。
// 只有 pending 占名额；quoted 会留在进行中列表里等玩家确认或议价，可能有多条。
function applyHintList(items) {
  const list = Array.isArray(items) ? items : [];
  const previous = new Map(openHints.value.map((item) => [item.id, item]));

  for (const [id, before] of previous) {
    const after = list.find((item) => item.id === id);
    if (!after || after.status === before.status) continue;
    if (after.status === "answered") {
      setNotice("success", "官方答复已送达，可在「队伍会话」查看。");
      // 答复是一条新的未读邮件：列表、余额、未读汇总一起刷新（可能是在别的标签页确认的）
      Promise.all([loadMails(), loadTipsBalance(), refreshUnreadSummary()]);
    } else if (after.status === "rejected") {
      setNotice(
        "error",
        `官方拒绝了这条求提示${after.reason ? `：${after.reason}` : "。"}`,
      );
    } else if (after.status === "quoted") {
      setNotice("success", `#${after.id} 官方已报价，可以确认或申请更便宜。`);
    }
  }

  openHints.value = list
    .filter(isOpenHint)
    .sort((a, b) => Number(b.id) - Number(a.id));
}

// 提问：只提交问题，不扣费；提交后开始等报价。
// 只要没有 pending（名额未占），即使还有 quoted 在等支付也能再提一条。
// 门禁：禁言 → E_MUTED；队伍被封禁 → E_FORBIDDEN「队伍已被官方封禁」（api-11 限制矩阵）。
async function submitHintQuestion() {
  if (hintSubmitting.value) {
    return;
  }

  if (isMuted.value) {
    setNotice("error", "禁言期间不能请求提示，可在「我的申诉」查看与提交申诉。");
    return;
  }
  if (isTeamBanned.value) {
    setNotice("error", "队伍已被官方封禁，暂不能请求提示。");
    return;
  }

  const content = hintQuestion.value.trim();
  if (!content) {
    setNotice("error", "请先填写问题描述。");
    return;
  }
  if (hintAttachments.uploading.value) {
    setNotice("error", "图片还在上传，请等上传完成后再提交。");
    return;
  }
  if (hintAttachments.failed.value) {
    setNotice("error", "有图片上传失败，请重试或移除后再提交。");
    return;
  }

  hintSubmitting.value = true;
  setNotice("pending", "正在提交求提示...");
  try {
    const response = await messageApi.requestHint({
      content,
      attachments: hintAttachments.serialize(),
    });
    const data = response?.data ?? {};
    hintQuestion.value = "";
    hintAttachments.clear();
    hintPendingCount.value = Number(data.pendingCount ?? 1) || 1;
    // 提问响应就是待报价状态，直接插到列表里，省一次 GET
    openHints.value = [
      {
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
        // 提问时附的截图（服务端形状：[{ id, fileName, mimeType, size, url }]）
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
      },
      ...openHints.value,
    ];
    setNotice("success", "已提交，等待官方报价（报价前不扣点数）。");
    // 2026-11-12 起提问会在队伍会话生成一封来信（自己发的，进「已发送」）：
    // 正在看这两个文件夹时静默刷新一下，不打断撰写面板。
    if (mailboxFilter.value === "sent" || mailboxFilter.value === "all") {
      void loadMails();
    }
  } catch (error) {
    setNotice("error", errorText(error, "提交求提示失败。"));
  } finally {
    hintSubmitting.value = false;
  }
}

// 确认扣费：按这条请求当前的报价扣本队 tips，答复随后进队伍会话。
async function confirmHint(item) {
  if (hintActing.value || item?.status !== "quoted") {
    return;
  }

  const id = item.id;
  hintActing.value = `${id}:confirm`;
  setNotice("pending", `正在确认 #${id}...`);
  try {
    const response = await messageApi.confirmHint(id);
    const data = response?.data ?? {};
    // 已扣费 → 从进行中列表移除
    openHints.value = openHints.value.filter((row) => row.id !== id);
    setNotice(
      "success",
      `已确认 #${id}，扣除 ${data.cost ?? 0} 点；答复已发到「队伍会话」，可在收件箱查看。`,
    );
    // 答复是一条新邮件：刷新列表、余额、「待报价」名额（可能还占着别的请求），
    // 以及未读汇总（GET /msg/mails/summary）——顶栏角标要立刻反映出这条新答复
    await Promise.all([
      loadMails(),
      loadTipsBalance(),
      refreshHintPendingCount(),
      refreshUnreadSummary(),
    ]);
    // 2026-11-12 起答复是对「提问邮件」的回复：确认后直接打开那条线程，省得自己去翻收件箱
    const answerMailId = Number(data.msgId) || 0;
    if (answerMailId) {
      activeTab.value = "inbox";
      mailboxFilter.value = "inbox";
      inboxFilter.value = "all";
      await loadMails();
      await openMail(answerMailId);
    }
  } catch (error) {
    // 余额不足不是死路：报价保留，补点数后重试同一条即可
    if (error?.code === "E_TIPS_SHORT") {
      const detail = error?.payload?.error?.detail ?? {};
      setNotice(
        "error",
        `本队 tips 不足（需要 ${detail.required ?? "?"}，当前 ${detail.balance ?? tipsBalance.value}）；补齐后可再次确认 #${id} 的报价。`,
      );
    } else {
      setNotice("error", errorText(error, "确认失败。"));
    }
    // 状态可能已被别处改动（如已处理），拉一次最新状态
    await refreshHintSnapshot();
  } finally {
    hintActing.value = "";
  }
}

// 申请更便宜：整个提问只允许一次，不加价、不扣费；
// 「可能答不全」这句提醒必须由前端在发请求之前给出（后端不提供）。
function requestCheaper(item) {
  if (hintActing.value || !canRequestCheaperOf(item)) {
    return;
  }

  hintConfirm.value = {
    title: "申请更便宜",
    text: "更便宜的提示可能无法回答所有问题，确定要申请吗？",
    confirmText: "申请",
    run: () => submitCheaper(item),
  };
}

async function submitCheaper(item) {
  const id = item?.id;
  hintConfirm.value = null;
  if (!id) {
    return;
  }

  hintActing.value = `${id}:cheaper`;
  try {
    await messageApi.requestCheaperHint(id);
    setNotice("success", `已申请 #${id} 更便宜，等待官方回应；期间也可以直接按当前价确认。`);
  } catch (error) {
    setNotice("error", errorText(error, "申请失败。"));
  } finally {
    hintActing.value = "";
    // 409（已申请过 / 已是最低价）时以服务端状态为准，把入口置灰
    await refreshHintSnapshot();
  }
}

// 关闭请求：放弃这条提示，服务端会清掉已备好的答复。只影响这一条。
function closeHint(item) {
  if (hintActing.value || !isOpenHint(item)) {
    return;
  }

  hintConfirm.value = {
    title: `关闭求提示 #${item.id}`,
    text: "关闭后将放弃这条求提示（已备好的答复也会被清除），确认关闭？",
    confirmText: "关闭",
    run: () => submitClose(item),
  };
}

async function submitClose(item) {
  const id = item?.id;
  hintConfirm.value = null;
  if (!id) {
    return;
  }

  hintActing.value = `${id}:close`;
  try {
    const response = await messageApi.closeHint(id);
    const data = response?.data ?? {};
    openHints.value = openHints.value.filter((row) => row.id !== id);
    setNotice(
      "success",
      Number(data.refunded) > 0
        ? `已关闭 #${id}，退回 ${data.refunded} 点。`
        : `已关闭 #${id}。`,
    );
    // 关闭可能释放 pending 名额，也可能只是结束一条 quoted，按服务端为准重算
    await Promise.all([
      loadTipsBalance(),
      refreshHintPendingCount(),
      loadHintRequests({ reset: true }),
    ]);
  } catch (error) {
    setNotice("error", errorText(error, "关闭失败。"));
    await refreshHintSnapshot();
  } finally {
    hintActing.value = "";
  }
}

// 从「提示记录」里跳到某一条进行中的请求（高亮它，并关闭弹窗）
function focusHint(item) {
  hintHistoryOpen.value = false;
  focusedHintId.value = item?.id ?? null;
  clearNotice();
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

// 本队点数流水：一页 20 条，按游标往后翻（GET /api/tips/ledger）
async function openLedger() {
  ledgerOpen.value = true;
  ledgerItems.value = [];
  ledgerNextCursor.value = null;
  ledgerTeamId.value = null;
  await loadLedger({ reset: true });
}

async function loadLedger({ reset = false } = {}) {
  if (ledgerLoading.value) {
    return;
  }

  ledgerLoading.value = true;
  try {
    const response = await tipsApi.getLedger({
      cursor: reset ? 0 : (ledgerNextCursor.value ?? 0),
      limit: 20,
    });
    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    ledgerItems.value = reset ? items : [...ledgerItems.value, ...items];
    ledgerNextCursor.value = data.nextCursor ?? null;
    // 无队伍时后端返回 teamId:null + 空列表，属正常空值
    ledgerTeamId.value = data.teamId ?? null;
  } catch (error) {
    setNotice("error", errorText(error, "加载点数流水失败。"));
  } finally {
    ledgerLoading.value = false;
  }
}

// 只刷新「待报价名额」：确认/关闭后不能直接把 pendingCount 清零 ——
// 队伍可以同时有 1 条 pending + 1 条 quoted，确认掉 quoted 时 pending 仍占着名额。
async function refreshHintPendingCount() {
  try {
    const response = await messageApi.getHintRequests({ limit: 1 });
    const data = response?.data ?? {};
    hintPendingCount.value = Number(data.pendingCount ?? 0) || 0;
  } catch (error) {
    // 配额数字读失败无伤大雅，下次历史 / 刷新会修正
  }
}

// 历史单页上限 100（api-10 §10.7）；页数上限只用于防御游标异常时死循环。
const HINT_HISTORY_PAGE_SIZE = 100;
const HINT_HISTORY_MAX_PAGES = 50;

// 拉全「请求历史」：只读第一页的话，较早的 pending / quoted 会落在页外，
// 于是从「进行中」面板消失——玩家明明还能确认付款，却再也找不到入口。
async function loadAllHintRequests() {
  const items = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let pendingCount = 0;
  let cursor = 0;

  for (let page = 0; page < HINT_HISTORY_MAX_PAGES; page += 1) {
    const response = await messageApi.getHintRequests({
      cursor,
      limit: HINT_HISTORY_PAGE_SIZE,
    });
    const data = response?.data ?? {};
    const batch = Array.isArray(data.items) ? data.items : [];
    // pendingCount 是队伍级统计，第一页给的就是完整值
    if (page === 0) {
      pendingCount = Number(data.pendingCount ?? 0) || 0;
    }

    for (const item of batch) {
      if (item?.id === null || item?.id === undefined) continue;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      items.push(item);
    }

    if (
      !data.hasMore ||
      data.nextCursor === null ||
      data.nextCursor === undefined
    ) {
      break;
    }
    // 游标没有前进就停，避免服务端异常时死循环
    if (seenCursors.has(data.nextCursor)) break;
    seenCursors.add(data.nextCursor);
    cursor = data.nextCursor;
  }

  return { items, pendingCount };
}

// 打开页面时恢复进行中的请求（pending / quoted），可能有多条，也可能不在最新一页里。
async function restoreOpenHints() {
  try {
    const { items, pendingCount } = await loadAllHintRequests();
    hintPendingCount.value = pendingCount;
    applyHintList(items);
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

// 用「请求历史」轮询当前状态：一次请求同时拿到 pendingCount 与每条请求的最新状态
//（pending / quoted / answered / rejected / closed 以及议价字段）。
let hintRefreshing = false;

async function refreshHintSnapshot() {
  if (hintRefreshing) {
    return;
  }

  hintRefreshing = true;
  try {
    // 一次轮询拉全历史：进行中列表必须是「所有 open」，不能只是最新一页里的 open
    const { items, pendingCount } = await loadAllHintRequests();
    hintPendingCount.value = pendingCount;

    // 记录弹窗开着：同步已翻到的行，并补上「比最新一行还新」的记录（别处新产生的）。
    // 未翻到的旧页不塞进来，否则分页游标会与内容错位、「加载更多」出现重复行。
    if (hintHistoryOpen.value && !hintRequestsLoading.value) {
      if (!hintRequests.value.length) {
        // 打开时历史为空（或首页没拉成）：现在有记录了，按首页重新加载，顺带恢复游标
        loadHintRequests({ reset: true });
      } else {
        const loaded = new Map(
          hintRequests.value.map((item) => [item.id, item]),
        );
        const newestId = hintRequests.value.reduce(
          (max, item) => Math.max(max, Number(item.id) || 0),
          0,
        );
        for (const item of items) {
          // 已加载的行：同步最新状态；新产生的行：id 一定比列表里最新一条更大
          if (loaded.has(item.id) || Number(item.id) > newestId) {
            loaded.set(item.id, item);
          }
        }
        hintRequests.value = [...loaded.values()].sort(
          (a, b) => Number(b.id) - Number(a.id),
        );
      }
    }

    // 进行中的请求：用完整历史里的最新状态覆盖（可能有多条 pending / quoted）
    applyHintList(items);
  } catch (error) {
    // 轮询失败静默处理：下一轮会重试，避免刷屏报错
  } finally {
    hintRefreshing = false;
  }
}

function startHintPolling() {
  if (hintTimer !== null) {
    return;
  }

  hintTimer = window.setInterval(() => {
    if (!document.hidden) {
      refreshHintSnapshot();
    }
  }, HINT_POLL_MS);
}

function stopHintPolling() {
  if (hintTimer !== null) {
    window.clearInterval(hintTimer);
    hintTimer = null;
  }
}

// 打开求提示面板 / 提示记录弹窗时立刻拉一次，并开始按 10 秒轮询；关掉就停
watch(hintPollingWanted, (wanted) => {
  if (wanted) {
    refreshHintSnapshot();
    startHintPolling();
  } else {
    stopHintPolling();
  }
});

// ---------- 生命周期 ----------

onMounted(async () => {
  if (!isLoggedIn.value) {
    return;
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  // 未读角标（GET /msg/mails/summary）由 App.vue 的全局轮询统一负责，本页只加载自己的数据。
  // 附件开关随页面取一次（策略因用户而异，不进缓存；拿不到就按关闭处理）。
  await Promise.all([
    loadMails(),
    loadTipsBalance(),
    restoreOpenHints(),
    loadPolicy(),
  ]);
  // 列表页的增量拉新（since_id），每分钟一次；详情 / 写信时不跑
  startMailPolling();
});

onBeforeUnmount(() => {
  stopHintPolling();
  stopMailPolling();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  // 释放尚未提交的本地预览 URL
  composeAttachments.dispose();
  hintAttachments.dispose();
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

    <template v-else>
      <!-- 禁言只关发信通道：读信、求提示的确认 / 议价 / 关闭都不受影响 -->
      <div v-if="isMuted" class="mute-banner">
        <strong>发信功能已被关闭</strong>
        <span>{{ muteNotice }}</span>
        <span class="mute-banner__tip">
          读信不受影响；如需申诉请前往「我的申诉」。
        </span>
      </div>

      <div class="mail-layout">
      <!-- 左侧功能列：写信、收信分类、频道与来源筛选 -->
      <aside class="mail-nav" aria-label="站内信功能">
        <!-- 禁言期间隐藏「写信」入口（写邮件 / 问题反馈 / 求提示提问都会被 403 E_MUTED） -->
        <button
          v-if="!isMuted"
          type="button"
          :class="['mail-nav__item', { 'is-active': activeView === 'compose' }]"
          @click="startNewMail"
        >
          写信
        </button>
        <p v-else class="mail-nav__locked">写信已关闭（禁言中）</p>

        <div class="mail-nav__section">
          <p class="mail-nav__group">文件夹</p>
          <div class="mail-nav__items">
            <button
              v-for="item in MAILBOX_VIEWS"
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
                v-if="item.value === 'inbox' && state.unreadMessages > 0"
                class="unread-badge"
              >
                {{ state.unreadMessages }}
              </span>
              <span
                v-else-if="item.value === 'archive' && state.unreadArchive > 0"
                class="unread-badge"
              >
                {{ state.unreadArchive }}
              </span>
            </button>
          </div>
        </div>
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
              <input
                v-if="composeReplyTo"
                id="compose-reply-subject"
                v-model="composeReplySubject"
                class="input"
                type="text"
                maxlength="80"
                :placeholder="replySubjectPlaceholder"
              />
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

          <!-- 请求提示：先提问（不扣费），官方报价后由玩家确认扣费；答复进队伍会话。
               只有 pending 占「每队 1 条」名额：可以有 1 条 pending + 多条 quoted 同时存在，
               每条各自确认（按各自 quotedCost 扣费）。 -->
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
                · 待报价 {{ hintPendingCount }}/1（只有「待报价」占名额，待确认的不占）
              </p>

              <!-- 进行中的请求（pending / quoted），可以有多条 -->
              <ul v-if="openHints.length" class="hint-open">
                <li
                  v-for="item in openHints"
                  :key="item.id"
                  :class="['hint-open__item', { 'is-focus': item.id === focusedHintId }]"
                >
                  <div class="hint-open__head">
                    <span class="hint-open__id">#{{ item.id }}</span>
                    <span class="hint-open__status">{{ hintStatusLabel(item.status) }}</span>
                    <span class="hint-open__cost">{{ hintCostText(item) }}</span>
                    <span v-if="item.status === 'pending'" class="hint-open__wait">
                      已等待 {{ waitedText(item.createdAt) }}
                    </span>
                  </div>
                  <p class="hint-open__question">{{ item.question }}</p>
                  <AttachmentGallery :items="item.attachments" />

                  <p v-if="item.status === 'pending'" class="helper-text">
                    等待官方报价…（报价前不扣费）
                  </p>
                  <template v-else>
                    <p class="helper-text">
                      官方报价：<strong>{{ item.quotedCost }}</strong> 点（确认后才扣费）
                    </p>
                    <p v-if="cheaperPendingOf(item)" class="helper-text">
                      已申请更便宜，等待官方回应；期间也可以直接按当前价确认。
                    </p>
                    <p v-else-if="item.isLowestPrice" class="helper-text">
                      官方已表示这就是最低报价。
                    </p>
                    <p v-else-if="item.cheaperDecidedAt" class="helper-text">
                      官方已回应你的降价申请，当前报价即最新价格。
                    </p>
                  </template>

                  <div class="hint-open__actions">
                    <button
                      v-if="canRequestCheaperOf(item)"
                      class="soft-btn"
                      type="button"
                      :disabled="Boolean(hintActing)"
                      @click="requestCheaper(item)"
                    >
                      {{ hintBusyOf(item, "cheaper") ? "申请中..." : "申请更便宜" }}
                    </button>
                    <button
                      v-if="item.status === 'quoted'"
                      class="primary-btn"
                      type="button"
                      :disabled="Boolean(hintActing)"
                      @click="confirmHint(item)"
                    >
                      {{
                        hintBusyOf(item, "confirm")
                          ? "确认中..."
                          : `确认（扣 ${item.quotedCost} 点）`
                      }}
                    </button>
                    <button
                      class="soft-btn"
                      type="button"
                      :disabled="Boolean(hintActing)"
                      @click="closeHint(item)"
                    >
                      {{ hintBusyOf(item, "close") ? "关闭中..." : "关闭请求" }}
                    </button>
                  </div>
                </li>
              </ul>

              <!-- 提交新请求：只要没有待报价（名额未占）就能提，既使还有待支付的请求 -->
              <div class="hint-submit">
                <template v-if="hintQuotaFull">
                  <p class="helper-text">
                    已有一条待报价的求提示（每队同时只能 1 条），等官方报价或先关闭它。
                  </p>
                </template>
                <template v-else>
                  <textarea
                    id="hint-question"
                    v-model="hintQuestion"
                    class="mail-editor hint-question"
                    :class="{ 'is-drop-target': hintDragging }"
                    rows="5"
                    maxlength="2000"
                    :placeholder="hintQuestionPlaceholder"
                    v-on="hintAttachEvents"
                  ></textarea>
                  <AttachmentPicker
                    v-if="attachmentsEnabled"
                    class="attach-inset"
                    :items="hintFiles"
                    :issue="hintIssue"
                    :disabled="hintSubmitting"
                    @pick="addHintFiles"
                    @remove="removeHint"
                    @retry="retryHint"
                  />
                  <p v-if="!tipsHasTeam" class="helper-text">
                    加入队伍后才能求提示。
                  </p>
                  <button
                    class="primary-btn"
                    type="button"
                    :disabled="
                      hintSubmitting ||
                      hintAttachBusy ||
                      !tipsHasTeam ||
                      !hintQuestion.trim()
                    "
                    @click="submitHintQuestion"
                  >
                    {{ hintSubmitting ? "提交中..." : "提交求提示" }}
                  </button>
                </template>
              </div>
            </div>

            <div class="composer__footer">
              <button class="soft-btn" type="button" @click="openHintHistory">
                提示记录
              </button>
              <button class="soft-btn" type="button" @click="openLedger">
                点数流水
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
              :class="{ 'is-drop-target': composeDragging }"
              rows="10"
              maxlength="2000"
              :placeholder="composePlaceholder"
              v-on="composeAttachEvents"
            ></textarea>

            <AttachmentPicker
              v-if="attachmentsEnabled"
              class="attach-inset"
              :items="composeFiles"
              :issue="composeIssue"
              :disabled="composing"
              @pick="addComposeFiles"
              @remove="removeCompose"
              @retry="retryCompose"
            />

            <div class="composer__footer">
              <button
                class="primary-btn"
                type="button"
                :disabled="composing || composeAttachBusy"
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
                  返回列表
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
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="archiveBusy || !threadRootId"
                  @click="toggleThreadArchive"
                >
                  {{ threadArchived ? "取消归档" : "归档" }}
                </button>
              </div>
              <span v-if="thread" class="detail-thread-meta">
                {{ thread.messageCount }} 封<template
                  v-if="Number(thread.unreadCount) > 0"
                >
                  · 未读 {{ thread.unreadCount }}</template
                >
                <template v-if="thread.shared"> · 全队可见</template>
              </span>
            </header>

            <article class="message-detail">
              <h2 class="letter-subject">
                {{ thread?.latestSubject || mail?.subject || "（无主题）" }}
              </h2>

              <div class="message-detail__meta-group">
                <span class="detail-label">发件人</span>
                <span>{{ mailSender }}</span>
                <span class="detail-label">频道</span>
                <span>{{ mail?.channelName || thread?.channelName || "—" }}</span>
                <span class="detail-label">来源</span>
                <span>{{ sourceLabel(mail?.source || thread?.source) }}</span>
              </div>

              <div v-if="messagesLoading && !messages.length" class="list-hint">
                正在加载邮件...
              </div>
              <div v-else-if="!messages.length" class="list-hint">
                暂无邮件记录。
              </div>

              <template v-else>
                <button
                  v-if="threadHasMore"
                  class="soft-btn"
                  type="button"
                  :disabled="messagesLoading"
                  @click="loadEarlierMessages"
                >
                  {{ messagesLoading ? "加载中..." : "加载更早的邮件" }}
                </button>
                <div class="letter-list">
                <article
                  v-for="(message, index) in messages"
                  :key="message.mailId"
                  class="letter"
                  :style="{ '--row-index': String(index) }"
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
                  <AttachmentGallery :items="message.attachments" />
                </article>
              </div>
              </template>
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
                <select
                  id="mail-filter-scope"
                  class="select select--compact"
                  aria-label="筛选：全部 / 未读 / 已读"
                  :value="inboxFilter"
                  @change="switchInboxFilter($event.target.value)"
                >
                  <option
                    v-for="item in INBOX_VIEWS"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </option>
                </select>
                <select
                  id="mail-filter-channel"
                  class="select select--compact"
                  aria-label="频道筛选"
                  :value="channelFilter"
                  @change="switchChannel($event.target.value)"
                >
                  <option
                    v-for="item in CHANNEL_VIEWS"
                    :key="item.value || 'all'"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </option>
                </select>
                <select
                  id="mail-filter-source"
                  class="select select--compact"
                  aria-label="来源筛选"
                  :value="sourceFilter"
                  @change="switchSource($event.target.value)"
                >
                  <option
                    v-for="item in SOURCE_VIEWS"
                    :key="item.value || 'all'"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </option>
                </select>
                <select
                  id="mail-filter-answered"
                  class="select select--compact"
                  aria-label="回复状态筛选"
                  :value="answeredFilter"
                  @change="switchAnswered($event.target.value)"
                >
                  <option
                    v-for="item in ANSWERED_VIEWS"
                    :key="item.value || 'any'"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </option>
                </select>
                <select
                  id="mail-view-threaded"
                  class="select select--compact"
                  aria-label="列表视图"
                  :value="threadedView ? '1' : '0'"
                  @change="switchThreaded($event.target.value)"
                >
                  <option
                    v-for="item in THREADED_VIEWS"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </option>
                </select>
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="mailsLoading || Boolean(batchBusy)"
                  title="把当前可见的全部未读标记为已读"
                  @click="markAllRead"
                >
                  全部已读
                </button>
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

            <!-- 批量操作：勾选行之后出现（一次最多 100 项） -->
            <div v-if="selectedCount" class="inbox-batch-bar">
              <span class="toolbar-label">已选 {{ selectedCount }} 项</span>
              <div class="toolbar-group">
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="Boolean(batchBusy)"
                  @click="runBatch('read')"
                >
                  标为已读
                </button>
                <button
                  v-if="mailboxFilter !== 'archive'"
                  class="soft-btn"
                  type="button"
                  :disabled="Boolean(batchBusy)"
                  @click="runBatch('archive')"
                >
                  归档
                </button>
                <!-- 「全部邮件」里两种状态的邮件都有，两个按钮都要给 -->
                <button
                  v-if="mailboxFilter === 'archive' || mailboxFilter === 'all'"
                  class="soft-btn"
                  type="button"
                  :disabled="Boolean(batchBusy)"
                  @click="runBatch('unarchive')"
                >
                  取消归档
                </button>
                <button
                  class="soft-btn"
                  type="button"
                  :disabled="Boolean(batchBusy)"
                  @click="clearSelection"
                >
                  取消选择
                </button>
              </div>
            </div>

            <div ref="inboxListRef" class="inbox-list">
              <div class="inbox-row inbox-row--head">
                <span class="inbox-check">
                  <input
                    type="checkbox"
                    :checked="allFilteredSelected"
                    :disabled="!filteredMails.length"
                    aria-label="全选当前列表"
                    @change="toggleSelectAll"
                  />
                </span>
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

              <div
                v-for="item in filteredMails"
                :key="`${mailsListToken}-${item.mailId}`"
                :class="[
                  'inbox-row',
                  'inbox-row--button',
                  {
                    'is-unread': rowUnread(item) > 0,
                    'is-selected': isSelected(item),
                  },
                ]"
                :style="{ '--row-index': String(rowEnterIndex(item)) }"
                role="button"
                tabindex="0"
                @click="openMail(item.mailId, rootIdOf(item))"
                @keydown.enter.prevent="openMail(item.mailId, rootIdOf(item))"
              >
                <span class="inbox-check" @click.stop>
                  <input
                    type="checkbox"
                    :value="item.mailId"
                    :checked="isSelected(item)"
                    :aria-label="`选择 ${item.latestSubject || item.subject || '邮件'}`"
                    @change="toggleSelect(item.mailId)"
                  />
                </span>
                <span class="inbox-sender" :title="rowSenderTitle(item)">{{
                  rowSender(item)
                }}</span>
                <span class="inbox-subject">
                  <strong>
                    {{ item.latestSubject || item.subject || "（无主题）" }}
                  </strong>
                  <small>
                    {{ sourceLabel(item.source) }} · {{ item.channelName }}
                    <template v-if="threadedView && rowMessageCount(item) > 1">
                      · 共 {{ rowMessageCount(item) }} 封
                    </template>
                    <template v-else-if="!threadedView && item.replyCount">
                      · {{ item.replyCount }} 条回复
                    </template>
                    <template v-if="Number(item.hasAttachments)">
                      · 含图片
                    </template>
                    <template v-if="Number(item.shared)"> · 全队可见</template>
                    <template v-if="Number(item.answered)"> · 已回复</template>
                    <template v-if="Number(item.archived)"> · 已归档</template>
                  </small>
                  <small v-if="item.snippet" class="inbox-snippet">
                    {{ item.snippet }}
                  </small>
                </span>
                <span class="inbox-time">{{
                  formatTime(item.lastReplyAt || item.createdAt)
                }}</span>
                <span class="inbox-unread">
                  <span v-if="rowUnread(item) > 0" class="unread-badge">
                    {{ rowUnread(item) }}
                  </span>
                  <template v-else>—</template>
                </span>
              </div>

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
    </template>

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
                @click="focusHint(item)"
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

    <!-- 本队点数流水（GET /api/tips/ledger）：余额变化都带 balanceAfter，可自查收支 -->
    <div v-if="ledgerOpen" class="modal-backdrop" @click.self="ledgerOpen = false">
      <div class="modal-card">
        <h2>本队点数流水</h2>
        <p
          v-if="!ledgerItems.length && ledgerTeamId === null && !ledgerLoading"
          class="helper-text"
        >
          还没有队伍：加入队伍后才会有点数流水。
        </p>
        <ul v-else-if="ledgerItems.length" class="ledger-list">
          <li v-for="item in ledgerItems" :key="item.id">
            <span
              class="ledger-list__delta"
              :class="{
                'is-plus': Number(item.delta) > 0,
                'is-minus': Number(item.delta) < 0,
              }"
            >
              {{ ledgerDeltaText(item.delta) }}
            </span>
            <span class="ledger-list__reason">{{ ledgerReasonLabel(item.reason) }}</span>
            <span class="ledger-list__balance">余额 {{ item.balanceAfter }}</span>
            <time>{{ formatTime(item.createdAt) }}</time>
            <small v-if="item.note" class="ledger-list__note">{{ item.note }}</small>
            <small v-if="item.operator" class="ledger-list__note">
              操作者：{{ item.operator }}
            </small>
          </li>
        </ul>
        <p v-else class="helper-text">
          {{ ledgerLoading ? "加载中..." : "暂无流水。" }}
        </p>
        <div class="modal-card__footer">
          <button
            v-if="ledgerNextCursor"
            class="soft-btn"
            type="button"
            :disabled="ledgerLoading"
            @click="loadLedger()"
          >
            加载更多
          </button>
          <button class="soft-btn" type="button" @click="ledgerOpen = false">
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

/* 功能分组容器：宽屏时透明掉，按钮仍直接排在单列里；窄屏才变成「标签 + 可换行的一组」。 */
.mail-nav__section,
.mail-nav__items {
  display: contents;
}

.mail-nav__group {
  margin: 10px 0 2px;
  padding: 0 12px;
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.08em;
}

/* 禁言时「写信」入口被替换成这句说明 */
.mail-nav__locked {
  margin: 0;
  padding: 9px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

/* 禁言提示条：只说明发信被关闭，读信功能照常 */
.mute-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 12px;
  padding: 10px 14px;
  border: 1px solid rgba(240, 173, 78, 0.6);
  border-radius: 10px;
  background: rgba(240, 173, 78, 0.12);
  font-size: 13px;
  line-height: 1.7;
}

.mute-banner__tip {
  color: var(--text-dim);
  font-size: 12px;
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

/* 列表工具栏里的筛选下拉：与「刷新」按钮同高，别抢列表标题的位置 */
.select--compact {
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
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

/* 拖拽图片到输入框时的落点提示（paste / drop 由 useAttachments 处理） */
.mail-editor.is-drop-target {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
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

/* 附件选择区的根元素（AttachmentPicker 的 class 会落到它的根 div 上）：
   与上方正文框 .mail-editor 的 margin 14px 18px 18px 保持同一条左右内距。
   组件本身不带左右 margin，申诉页那边的正文框是 100% 宽，那边不需要这个类。 */
.attach-inset {
  margin-right: 18px;
  margin-left: 18px;
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

/* 进行中的求提示（可同时有多条：1 条待报价 + 多条待确认） */
.hint-open {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hint-open__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.hint-open__item.is-focus {
  border-color: #0f7cff;
  box-shadow: 0 0 0 1px rgba(15, 124, 255, 0.35);
}

.hint-open__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.hint-open__id {
  font-weight: 600;
  color: var(--text);
}

.hint-open__cost {
  color: var(--text);
}

.hint-open__wait {
  margin-left: auto;
}

.hint-open__question {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.hint-open__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 新请求提交区：与进行中的卡片留出间隔 */
.hint-submit {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  flex-wrap: wrap;
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

/* 信件抬头信息：发件人 / 频道 / 来源 三列，标签在上、值在下。
   列优先填充（grid-auto-flow: column）正好让「标签 + 值」两两落进同一列。 */
.message-detail__meta-group {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: auto auto;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 14px;
  margin-top: 14px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-alt) 60%, transparent);
}

.detail-label {
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* 值：单行省略，长频道名不会把三列撑变形。 */
.message-detail__meta-group > span:not(.detail-label) {
  color: var(--text);
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 发件人是这一行里最该先看到的。 */
.message-detail__meta-group > span:nth-child(2) {
  font-weight: 600;
}

/* 第 2、3 列左侧加竖线，把三组信息隔开。 */
.message-detail__meta-group > span:nth-child(n + 3) {
  padding-left: 14px;
  border-left: 1px solid var(--border);
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
  overflow-x: hidden;
  overflow-y: auto;
}

.inbox-row {
  display: grid;
  grid-template-columns: 20px 116px minmax(0, 1fr) 120px 64px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
}

/* 勾选列：批量已读 / 归档用（api-8 §8.6 / §8.7） */
.inbox-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.inbox-check input {
  cursor: pointer;
}

.inbox-row.is-selected {
  background: var(--accent-soft);
}

/* 勾选后出现的批量操作条 */
.inbox-batch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 92%, transparent);
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
  /* 邮件行从右向左浮现；--row-index 是「本批第几封」，每批新邮件都从 0 重新逐封错开。 */
  animation: mail-slide-in 0.34s cubic-bezier(0.22, 0.61, 0.36, 1) backwards;
  animation-delay: calc(var(--row-index, 0) * 35ms);
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

/* 列表里的正文摘要（api-8 snippet，最多 60 字；纯图片时为「[图片]」） */
.inbox-snippet {
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 详情右上角的线程汇总：封数 / 未读 / 全队可见 */
.detail-thread-meta {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
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
  overflow-x: hidden;
  overflow-y: auto;
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
  /* 长串无空格的标题（URL / 编号）必须折行：详情容器已裁掉横向溢出，不折行就看不全。 */
  overflow-wrap: anywhere;
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
  /* 每封信同样自右向左浮现，--row-index 由回复链顺序提供。 */
  animation: mail-slide-in 0.34s cubic-bezier(0.22, 0.61, 0.36, 1)
    calc(var(--row-index, 0) * 35ms) backwards;
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

.reply-bar {
  margin-left: 5px;
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

.ledger-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ledger-list li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 96px 130px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
}

.ledger-list li small {
  grid-column: 1 / -1;
  color: var(--text-dim);
}

.ledger-list__delta {
  font-weight: 600;
  color: var(--text-dim);
}

.ledger-list__delta.is-plus {
  color: var(--accent);
}

.ledger-list__delta.is-minus {
  color: var(--danger);
}

.ledger-list__reason,
.ledger-list__balance,
.ledger-list time {
  color: var(--text-dim);
}

@media (max-width: 960px) {
  .inbox-row {
    grid-template-columns: 20px 92px minmax(0, 1fr) 88px 48px;
    gap: 8px;
    padding: 10px 12px;
  }

  /* 窄屏：功能列转到邮件区上方铺满整行，内部按功能分组换行。 */
  .mail-layout {
    flex-direction: column;
  }

  .mail-nav {
    width: auto;
    gap: 8px;
    padding: 12px;
  }

  /* 窄屏：每个功能分组独立成行，标签占左侧一列，按钮在右侧换行，不会跨分类混排。 */
  .mail-nav__section {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
  }

  .mail-nav__items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mail-nav__group {
    margin: 0;
    padding: 8px 0 0;
    letter-spacing: 0.06em;
  }

  .mail-nav__item {
    padding: 7px 10px;
  }

  /* 「写信」是独立按钮，不跟着列宽拉满，底色只贴合文字。 */
  .mail-nav > .mail-nav__item {
    align-self: flex-start;
  }
}

/* 邮件入场：自右向左滑入并淡入。列表行与详情里的信件共用同一条曲线。 */
@keyframes mail-slide-in {
  from {
    opacity: 0;
    transform: translateX(28px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .inbox-row--button,
  .letter {
    animation: none;
  }
}
</style>
