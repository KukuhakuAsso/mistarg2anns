// 全局游戏状态：服务端权威数据（账号 / 队伍 / 未读 / tips / 处罚）+ 本地收藏板。
// 单例模块，任意组件直接调用 useGameState() 即可读写同一份状态。
//
// 题目与目录全部来自 GET /api/puzzle/map（含解锁、已解状态），本模块不再保留任何 mock 题目 / 线索数据。

import { computed, reactive, watch } from "vue";
import { CARD_GAP, CARD_H, CARD_W } from "@/config/board";
import { validateTeamName } from "@/config/team";
import { extractErrorMessage, extractFieldMessage } from "@/api/errors";
import { teamApi } from "@/api/team";
import { messageApi } from "@/api/message";
import { tipsApi } from "@/api/tips";
import { meApi } from "@/api/me";
import { authApi } from "@/api/auth";
import { clearAccessToken } from "@/api/request";

const STORAGE_KEY = "mistarg2anns:state:v1";

// 账号处罚状态的空值（未登录 / 尚未拉取 / 切换账号后）。
// 字段口径见 api-11-moderation-mute.md：banned 是账号封禁；muted 是「账号级或队伍级禁言」的合一布尔。
// teamAppeal 是队长代表队伍申诉的那一块（队伍级禁言 / 队伍封禁），非队长或队伍无处罚时为 null。
function createEmptyAccountStatus() {
  return {
    loaded: false,
    status: 2,
    banned: false,
    banReason: null,
    banUntil: null,
    muteReason: null,
    muteUntil: null,
    muted: false,
    team: null,
    appeal: null,
    teamAppeal: null,
  };
}

// 生成一份全新的初始状态：无浏览标记、收藏板为空、未登录。
function createDefaultState() {
  return {
    visitedFolders: [],
    unreadMessages: 0,
    // 队伍级 tips（服务端权威数据，不持久化）：余额与今日累积，供顶栏与求提示面板共用
    teamTips: {
      loaded: false,
      hasTeam: false,
      balance: 0,
      today: null,
    },
    // 账号处罚状态（GET /api/me/status，服务端权威、不持久化）：
    // banned = 账号封禁（全局门禁）；muted = 账号级禁言或所在队伍禁言（只拦发信）。
    accountStatus: createEmptyAccountStatus(),
    // 本会话是否「登录时账号快照里就带着封禁」：是则不再因为 /me/status 报 banned 而强制登出，
    // 否则会把刚重新登录的封禁用户又踢下线（无限循环）。
    sessionBanAcknowledged: false,
    // 强制登出后留给登录页展示的一次性提示（如「账号已被封禁，请重新登录后提交申诉」）。
    sessionNotice: "",
    unlockedTips: [],
    board: [],
    boardLabels: {},
    user: {
      currentUser: null,
      users: [],
      // 队伍信息全部由后端 /api/team/* 提供：
      // loaded 表示是否已成功拉取过；team 为已入队时的后端队伍对象；
      // myJoinRequest 为未入队时的「我的加入申请」。
      team: {
        loaded: false,
        team: null,
        myJoinRequest: null,
      },
    },
    ui: {
      cluePanelOpen: true,
      theme: "system", // system | light | dark
    },
  };
}

// 校验一条板面排布数据是否合法：卡片 id 必须能在 boardLabels 快照里解析到，坐标必须有限。
function isPlacement(item, labels = {}) {
  return (
    Boolean(item) &&
    typeof item.clueId === "string" &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y) &&
    Boolean(labels[item.clueId])
  );
}
// 从 localStorage 读取并校验持久化的游戏进度；缺失或损坏时退回初始状态。

function loadState() {
  const fallback = createDefaultState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const saved = JSON.parse(raw);
    // 板面卡片的标题快照（拖进来的题目）：先于 board 还原，过滤排布时要用它判断 id 是否可解析。
    const boardLabels =
      saved.boardLabels && typeof saved.boardLabels === "object"
        ? Object.fromEntries(
            Object.entries(saved.boardLabels).filter(
              ([id, value]) =>
                typeof id === "string" &&
                Boolean(value) &&
                typeof value.title === "string",
            ),
          )
        : {};
    // 以默认状态为底再覆盖「可持久化」的字段：
    // 这样新增的、不持久化的字段（teamTips、accountStatus 等）不会因为本地存的是旧结构而缺失。
    return {
      ...fallback,
      boardLabels,
      visitedFolders: Array.isArray(saved.visitedFolders)
        ? saved.visitedFolders
        : [],
      unreadMessages:
        Number.isInteger(saved.unreadMessages) && saved.unreadMessages >= 0
          ? saved.unreadMessages
          : fallback.unreadMessages,
      // 队伍 tips 与处罚状态都是服务端数据，不从本地恢复
      teamTips: { ...fallback.teamTips },
      accountStatus: { ...fallback.accountStatus },
      unlockedTips: Array.isArray(saved.unlockedTips)
        ? saved.unlockedTips.filter((tipId) => typeof tipId === "string")
        : [],
      board: Array.isArray(saved.board)
        ? saved.board.filter((item) => isPlacement(item, boardLabels))
        : [],
      user: {
        ...fallback.user,
      },
      ui: { ...fallback.ui, ...(saved.ui ?? {}) },
    };
  } catch (error) {
    console.warn("[mistarg2anns] 读取本地进度失败，已使用初始状态", error);
    return fallback;
  }
}

const state = reactive(loadState());

// 监听游戏状态变化并持久化到 localStorage。
watch(
  state,
  (value) => {
    try {
      const persistedState = {
        visitedFolders: value.visitedFolders,
        unreadMessages: value.unreadMessages,
        unlockedTips: value.unlockedTips,
        board: value.board,
        boardLabels: value.boardLabels,
        ui: value.ui,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
    } catch (error) {
      console.warn("[mistarg2anns] 保存本地进度失败", error);
    }
  },
  { deep: true },
);

// 当前用户身份变化（登录 / 登出 / 切换账号）时集中清空队伍缓存。
// 不会在新账号的 /team/me 失败时继续渲染上一个账号的队伍、成员与邀请码。
watch(
  () => state.user.currentUser?.id ?? state.user.currentUser?.username ?? null,
  () => {
    state.user.team = { loaded: false, team: null, myJoinRequest: null };
    // 未读角标是服务端数据，切换账号时一并清零，避免残留上一账号的未读数。
    state.unreadMessages = 0;
    // 队伍 tips 同理：切换账号后先清空，等新的 /tips/balance 回来再填。
    state.teamTips = {
      loaded: false,
      hasTeam: false,
      balance: 0,
      today: null,
    };
    // 处罚状态也不能跨账号残留（否则上一个账号的封禁会把新账号也锁住）。
    state.accountStatus = createEmptyAccountStatus();
  },
);

// ---------- 派生状态 ----------

// 派生：板面上已放置的卡片，附带其坐标（标题来自 boardLabels 快照）。
const boardClues = computed(() =>
  state.board
    .map((placement) => {
      const label = state.boardLabels?.[placement.clueId];
      if (!label) return null;
      return {
        id: placement.clueId,
        kind: "puzzle",
        title: label.title,
        folderName: label.subtitle,
        thumbnail: null,
        x: placement.x,
        y: placement.y,
      };
    })
    .filter(Boolean),
);

// 派生：尚未放到板面上的卡片池（待用区）。
const poolClues = computed(() => {
  const onBoard = new Set(state.board.map((placement) => placement.clueId));

  return Object.entries(state.boardLabels ?? {})
    .filter(([id]) => !onBoard.has(id))
    .map(([id, label]) => ({
      id,
      kind: "puzzle",
      title: label.title,
      folderName: label.subtitle,
      thumbnail: null,
    }));
});

// ---------- 队伍派生状态 ----------

// 派生：当前队伍对象；未入队时为 null。
const currentTeam = computed(() => state.user.team.team);

// 派生：我的加入申请；未入队时才可能有值。
const myJoinRequest = computed(() => state.user.team.myJoinRequest);

// 派生：我是否是当前队伍的队长。
const isTeamCaptain = computed(() => {
  const team = currentTeam.value;
  const me = state.user.currentUser;
  if (!team || !me) {
    return false;
  }
  return String(team.captainId) === String(me.id);
});

// 派生：队伍是否已确认参赛并进入锁定态。
const teamLocked = computed(() => Boolean(currentTeam.value?.confirmedAt));

// 派生：待处理的加入申请列表（仅队长能拿到）。
const teamPendingRequests = computed(
  () => currentTeam.value?.pendingRequests ?? [],
);

// ---------- 操作 ----------

// 仅将某个档案标记为已访问（本地记录，只用于桌面「新文件」角标）。
function markFolderVisited(folderId) {
  if (!state.visitedFolders.includes(folderId)) {
    state.visitedFolders.push(folderId);
  }
}

// 记录一张「从档案拖进板面的题目」卡片的标题快照。
// 板面只存 id + 坐标，标题与来源存在这里：题目来自服务端 map，
// 靠这份快照才能在脱离 map 时（刷新、换页）照常渲染板面卡片。
function registerBoardCard({ id, title, subtitle } = {}) {
  if (!id || !title) return;
  state.boardLabels = {
    ...state.boardLabels,
    [id]: { title, subtitle: subtitle || "" },
  };
}

// 查询某条提示是否已解锁。
function isTipUnlocked(tipId) {
  return state.unlockedTips.includes(tipId);
}

// 解锁一条提示：只记录本地已解锁（服务端暂无静态提示的扣点接口，点击不做任何后端交互）。
// 门槛读队伍余额 state.teamTips.balance（由 /tips/balance 轮询维护），但只读不改：
// 解锁不会扣减这个数字，真正扣费等后端接口就绪后再接。
function unlockTip(tipId) {
  if (isTipUnlocked(tipId) || state.teamTips.balance < 1) return false;

  state.unlockedTips.push(tipId);
  return true;
}

// 在指定坐标放置一条线索；若该线索已在板面则仅更新其坐标。
function placeClue(clueId, x, y) {
  const existing = state.board.find((item) => item.clueId === clueId);
  if (existing) {
    existing.x = x;
    existing.y = y;
    return;
  }
  state.board.push({ clueId, x, y });
}

// 从板面移除一条线索。
function removeClueFromBoard(clueId) {
  state.board = state.board.filter((item) => item.clueId !== clueId);
}

// 清空板面上的所有线索。
function clearBoard() {
  state.board = [];
}

// 按列网格排布，依据板面实际宽度计算第 index 张线索卡应放置的坐标。
function gridPosition(index, boardWidth) {
  const usable = Math.max(boardWidth, CARD_W + CARD_GAP);
  const columns = Math.max(
    1,
    Math.floor((usable + CARD_GAP) / (CARD_W + CARD_GAP)),
  );
  return {
    x: CARD_GAP + (index % columns) * (CARD_W + CARD_GAP),
    y: CARD_GAP + Math.floor(index / columns) * (CARD_H + CARD_GAP),
  };
}

// 按当前板面宽度重新为所有已放置线索计算网格坐标。
function arrangeBoard(boardWidth) {
  state.board = state.board.map((item, index) => ({
    clueId: item.clueId,
    ...gridPosition(index, boardWidth),
  }));
}

// 不经拖拽的备用入口：直接追加一条线索到板面末尾。
function addClueToBoard(clueId, boardWidth) {
  const { x, y } = gridPosition(state.board.length, boardWidth);
  placeClue(clueId, x, y);
}

// 切换线索栏的展开 / 收起状态。未登录时不允许打开（返回 false）。
function toggleCluePanel() {
  if (!state.user.currentUser) return false;
  state.ui.cluePanelOpen = !state.ui.cluePanelOpen;
  return true;
}

// 清空全部游戏进度并恢复初始状态，但保留当前界面设置。
function resetProgress() {
  Object.assign(state, createDefaultState(), { ui: state.ui });
}

// ---------- 队伍操作 ----------

// 从后端错误对象提取可读文案（含 detail.fields 里的字段级原因）。
function teamErrorMessage(error, fallback) {
  return extractErrorMessage(error, fallback);
}

// 当前登录账号的身份标识，用于判断异步响应是否仍属于当前活跃账号。
function currentAccountKey() {
  const user = state.user.currentUser;
  if (!user) {
    return null;
  }
  return user.id ?? user.username ?? null;
}

// 队伍请求代号：每次发起新的 loadMyTeam 时递增，用于丢弃更早发出的过期响应。
let teamRequestGeneration = 0;

// 拉取「我的队伍 + 我的加入申请」并写入本地状态（GET /api/team/me）。
async function loadMyTeam() {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再查看队伍。" };
  }

  // 记录发起时的账号与请求代号；响应回来时若已不匹配，说明账号已切换或有更新的请求，直接丢弃。
  const accountKey = currentAccountKey();
  const requestId = ++teamRequestGeneration;

  try {
    const response = await teamApi.getMyTeam();
    if (
      requestId !== teamRequestGeneration ||
      accountKey !== currentAccountKey()
    ) {
      return { ok: false, stale: true, message: "队伍信息已过期。" };
    }

    const data = response?.data ?? {};
    state.user.team.team = data.team ?? null;
    state.user.team.myJoinRequest = data.myJoinRequest ?? null;
    state.user.team.loaded = true;
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: teamErrorMessage(error, "获取队伍信息失败。"),
    };
  }
}

// 创建队伍（POST /api/team），成功后重新拉取我的队伍。
async function createTeam(name, intro = "") {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再创建队伍。" };
  }

  // 建队前先按同一套规则本地校验，避免明显不合规的队名白跑一次接口。
  const validation = validateTeamName(name);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  try {
    await teamApi.createTeam({
      name: validation.value,
      intro: String(intro ?? "").trim(),
    });
    await loadMyTeam();
    return { ok: true, message: `队伍「${validation.value}」创建成功。` };
  } catch (error) {
    const payload = error?.payload ?? {};

    return {
      ok: false,
      message: teamErrorMessage(error, "创建队伍失败。"),
      status: error?.status,
      code: payload?.code || payload?.error?.code || error?.code || "",
      // 400 E_VALIDATION 时后端会在 detail.fields 里写明原因；这里只取 name 的，
      // 建队同时提交 intro，按字段名取值才不会把简介的原因落到队名输入框下方。
      nameError: extractFieldMessage(error, "name"),
    };
  }
}

// 凭邀请码申请加入队伍（POST /api/team/join）；是否直接入队取决于队伍的自动审批设置。
async function joinTeam(code) {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再加入队伍。" };
  }

  const cleanCode = String(code ?? "").trim();
  if (!cleanCode) {
    return { ok: false, message: "请输入邀请码。" };
  }

  try {
    const response = await teamApi.applyJoin(cleanCode);
    const data = response?.data ?? {};
    await loadMyTeam();
    return {
      ok: true,
      joined: Boolean(data.joined),
      message: data.joined
        ? `已加入队伍${data.teamName ? `「${data.teamName}」` : ""}。`
        : `已提交加入申请${data.teamName ? `：${data.teamName}` : ""}，等待队长确认。`,
      data,
    };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "加入队伍失败。") };
  }
}

// 队长更换邀请码（POST /api/team/invite），旧码立即失效。
async function rotateInviteCode() {
  try {
    await teamApi.rotateInvite();
    await loadMyTeam();
    return { ok: true, message: "邀请码已更新。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "更换邀请码失败。") };
  }
}

// 队长开关自动审批（POST /api/team/join/auto-approve）。
async function setAutoApprove(enabled) {
  try {
    await teamApi.setAutoApprove(Boolean(enabled));
    await loadMyTeam();
    return {
      ok: true,
      message: enabled ? "已开启自动审批。" : "已关闭自动审批。",
    };
  } catch (error) {
    return {
      ok: false,
      message: teamErrorMessage(error, "设置自动审批失败。"),
    };
  }
}
// 退队（POST /api/team/leave）；队长且没有其他成员时会顺带解散队伍。
async function leaveTeam() {
  try {
    const response = await teamApi.leaveTeam();
    const dissolved = Boolean(response?.data?.dissolved);
    await loadMyTeam();
    return {
      ok: true,
      message: dissolved ? "你已退出并解散了队伍。" : "已退出队伍。",
    };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "退出队伍失败。") };
  }
}

// 队长同意某条加入申请（POST /api/team/join/confirm）。
async function confirmJoinRequest(requestId) {
  try {
    await teamApi.confirmJoin(requestId);
    await loadMyTeam();
    return { ok: true, message: "已同意该加入申请。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "同意申请失败。") };
  }
}

// 队长拒绝某条加入申请（POST /api/team/join/reject）。
async function rejectJoinRequest(requestId) {
  try {
    await teamApi.rejectJoin(requestId);
    await loadMyTeam();
    return { ok: true, message: "已拒绝该加入申请。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "拒绝申请失败。") };
  }
}

// 申请人取消自己的待确认申请（POST /api/team/join/cancel）。
async function cancelJoinRequest() {
  try {
    await teamApi.cancelJoin();
    await loadMyTeam();
    return { ok: true, message: "已取消加入申请。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "取消申请失败。") };
  }
}

// 队长确认参赛（POST /api/team/start），确认后队伍进入锁定态。
async function startTeam() {
  try {
    await teamApi.startTeam();
    await loadMyTeam();
    return { ok: true, message: "已确认参赛，队伍进入锁定态。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "确认参赛失败。") };
  }
}

// 队长取消确认参赛（POST /api/team/start/cancel），仅官方开赛前可用。
async function cancelStartTeam() {
  try {
    await teamApi.cancelStart();
    await loadMyTeam();
    return { ok: true, message: "已取消确认参赛。" };
  } catch (error) {
    return {
      ok: false,
      message: teamErrorMessage(error, "取消确认参赛失败。"),
    };
  }
}

// 队长移出成员（DELETE /api/team/member/:id），accountId 为被移除成员的账号 ID。
async function removeMember(accountId) {
  try {
    await teamApi.removeMember(accountId);
    await loadMyTeam();
    return { ok: true, message: "已移出该成员。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "移出成员失败。") };
  }
}

// 队长转让队长（POST /api/team/transfer），accountId 为目标成员的账号 ID。
async function transferCaptain(accountId) {
  try {
    await teamApi.transferCaptain(accountId);
    await loadMyTeam();
    return { ok: true, message: "已转让队长。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "转让队长失败。") };
  }
}

// 队长解散队伍（POST /api/team/dissolve）。
async function dissolveTeam() {
  try {
    await teamApi.dissolveTeam();
    await loadMyTeam();
    return { ok: true, message: "队伍已解散。" };
  } catch (error) {
    return { ok: false, message: teamErrorMessage(error, "解散队伍失败。") };
  }
}

// ---------- 站内信（未读角标） ----------

// 未读汇总请求代号：轮询、页面切换、标记已读后都会触发，只接受最新一次的结果。
let unreadRequestGeneration = 0;

// 刷新未读角标（GET /api/msg/mails/summary），把「有未读的对话数」写入全局状态供顶栏与桌面展示。
// 失败时静默处理，不影响页面主流程。
async function refreshUnreadSummary() {
  if (!state.user.currentUser) {
    state.unreadMessages = 0;
    return { ok: false };
  }

  // 记录发起时的账号与请求代号：请求期间可能登出或切换账号（身份 watcher 会把角标清零），
  // 迟到的响应属于上一个账号或更早的一次请求，直接丢弃，不能覆盖当前状态。
  const accountKey = currentAccountKey();
  const requestId = ++unreadRequestGeneration;

  try {
    const response = await messageApi.getMailsSummary();
    if (
      requestId !== unreadRequestGeneration ||
      accountKey !== currentAccountKey()
    ) {
      return { ok: false, stale: true };
    }
    state.unreadMessages = Number(response?.data?.total ?? 0) || 0;
    return { ok: true, total: state.unreadMessages };
  } catch {
    return { ok: false };
  }
}

// 余额请求代号：轮询、进入档案、确认求提示后都会触发，只接受最新一次的结果。
let tipsRequestGeneration = 0;

// 刷新队伍 tips 余额（GET /api/tips/balance），供顶栏与求提示面板共用。
// 无队伍是正常空值（200 + teamId:null + 零值），不算错误；失败时静默，保持上一次的数字。
async function refreshTeamTips() {
  if (!state.user.currentUser) {
    state.teamTips = { loaded: false, hasTeam: false, balance: 0, today: null };
    return { ok: false };
  }

  // 同上：账号切换后迟到的响应会把上一个账号的队伍余额 / hasTeam 写回来，
  // 让无队伍的账号看起来还在队里（还能去求提示）；更早的请求也不该覆盖更新的余额。
  const accountKey = currentAccountKey();
  const requestId = ++tipsRequestGeneration;

  try {
    const response = await tipsApi.getBalance();
    if (
      requestId !== tipsRequestGeneration ||
      accountKey !== currentAccountKey()
    ) {
      return { ok: false, stale: true };
    }
    const data = response?.data ?? {};
    state.teamTips = {
      loaded: true,
      hasTeam: data.teamId !== null && data.teamId !== undefined,
      // 同队任何人消费都会让这个数字变化，前端不缓存
      balance: Number(data.balance ?? 0) || 0,
      today: data.today ?? null,
    };
    return { ok: true, ...state.teamTips };
  } catch {
    return { ok: false };
  }
}

// 刷新账号处罚状态（GET /api/me/status）。处罚可能被官方随时下发/解除、或 until 到期自动解除，
// 所以必须轮询；封禁与禁言的口径见 api-11-moderation-mute.md。
// 失败时静默（不覆盖已有状态），401 由请求层统一处理。
async function refreshAccountStatus() {
  if (!state.user.currentUser) {
    state.accountStatus = createEmptyAccountStatus();
    return { ok: false };
  }

  // 记录发起时的账号：轮询期间可能切换了账号（或已登出），响应回来时这份状态就属于上一个账号了。
  // 直接写入会把 A 的封禁/禁言记到 B 头上，封禁分支甚至会强制登出 B，所以必须先按账号比对再落状态。
  const accountKey = currentAccountKey();

  try {
    const response = await meApi.getStatus();
    if (accountKey !== currentAccountKey()) {
      return { ok: false, stale: true };
    }

    const data = response?.data ?? {};
    const team = data.team ?? null;
    state.accountStatus = {
      loaded: true,
      status: Number(data.status ?? 2) || 2,
      banned: Boolean(data.banned),
      banReason: data.ban_reason ?? null,
      banUntil: data.ban_until ?? null,
      muteReason: data.mute_reason ?? null,
      muteUntil: data.mute_until ?? null,
      // muted 是布尔：本人账号级禁言 或 所在队伍禁言，两者都会拦发信
      muted: Boolean(data.muted),
      team: team
        ? {
            teamId: team.teamId ?? null,
            teamName: team.teamName ?? null,
            status: Number(team.status ?? 0) || 0,
            reason: team.reason ?? null,
            until: team.until ?? null,
            muted: Boolean(team.muted),
          }
        : null,
      appeal: data.appeal ?? null,
      teamAppeal: data.teamAppeal ?? null,
    };

    // 会话中途被封（本次登录时快照里还没有封禁）：立刻退出登录。
    // 封禁会递增 token_version，旧令牌已全部失效；留在原地只会得到一串 401/403，
    // 连 /me/* 申诉接口都调不动。封禁账号仍可登录，重新登录后即可申诉。
    if (state.accountStatus.banned && !state.sessionBanAcknowledged) {
      const reason = state.accountStatus.banReason;
      await forceLogout(
        `账号已被封禁${reason ? `：${reason}` : ""}，请重新登录后提交申诉。`,
      );
      return { ok: false, banned: true, loggedOut: true };
    }

    return { ok: true, ...state.accountStatus };
  } catch {
    return { ok: false };
  }
}

// 收到 403 E_BANNED 时立刻把账号标记为封禁（详情等 /me/status 回来再补全），
// 让全局守卫先把界面切到申诉页。本地存的是旧结构时 accountStatus 可能缺失，这里补空对象。
function markAccountBanned() {
  if (!state.accountStatus) {
    state.accountStatus = createEmptyAccountStatus();
  }
  state.accountStatus.loaded = true;
  state.accountStatus.banned = true;
  return state.accountStatus;
}

// 登录 / 恢复会话后，用账号快照里的封禁字段立即标记：
// ① 首屏不必等 /api/me/status 就知道被封（避免先渲染再跳转）；
// ② 标记「本会话已知封禁」，后续 /me/status 再报 banned 不会触发强制登出。
// 封禁账号的登录本身是成功的（200 + account.banned），所以这条路径是常态。
function applyAccountSnapshot(account) {
  if (!account) return;
  if (!account.banned) {
    state.sessionBanAcknowledged = false;
    return;
  }

  state.accountStatus = {
    ...createEmptyAccountStatus(),
    loaded: true,
    status: 4,
    banned: true,
    banReason: account.ban_reason ?? account.banReason ?? null,
    banUntil: account.ban_until ?? account.banUntil ?? null,
  };
  state.sessionBanAcknowledged = true;
}

// 强制退出登录：清本地令牌与账号状态，并尽力撤销服务端会话。
// 封禁会递增 token_version（旧令牌全部失效），只有重新登录才能拿到能调 /me/* 的令牌；
// 会话彻底失效（401 刷新也救不回来）时同样走这里，避免用户卡在「看似登录但什么都做不了」。
// 调用后 currentUser 变 null，App 的守卫会把用户送回登录页。
async function forceLogout(message = "") {
  state.sessionNotice = message;
  try {
    // 封禁账号的 /auth/logout 也是 200；令牌已失效时失败也不影响本地清理
    await authApi.logout();
  } catch {
    // 忽略：本地清理才是关键
  }
  clearAccessToken();
  state.user.currentUser = null;
  state.accountStatus = createEmptyAccountStatus();
  state.sessionBanAcknowledged = false;
}

// 取走一次性提示（登录页展示后清空）
function consumeSessionNotice() {
  const message = state.sessionNotice;
  state.sessionNotice = "";
  return message;
}

// 组合式函数入口：任何组件调用都会获得同一份全局状态与同一组操作函数。
export function useGameState() {
  return {
    state,
    boardClues,
    poolClues,
    // 队伍派生状态
    currentTeam,
    myJoinRequest,
    isTeamCaptain,
    teamLocked,
    teamPendingRequests,
    markFolderVisited,
    registerBoardCard,
    isTipUnlocked,
    unlockTip,
    placeClue,
    removeClueFromBoard,
    clearBoard,
    arrangeBoard,
    addClueToBoard,
    toggleCluePanel,
    resetProgress,
    // 队伍接口操作
    loadMyTeam,
    createTeam,
    joinTeam,
    rotateInviteCode,
    setAutoApprove,
    confirmJoinRequest,
    rejectJoinRequest,
    cancelJoinRequest,
    startTeam,
    cancelStartTeam,
    removeMember,
    leaveTeam,
    transferCaptain,
    dissolveTeam,
    // 站内信未读角标
    refreshUnreadSummary,
    // 队伍级 tips 余额
    refreshTeamTips,
    // 账号处罚状态（封禁 / 禁言 / 申诉摘要）
    refreshAccountStatus,
    markAccountBanned,
    applyAccountSnapshot,
    forceLogout,
    consumeSessionNotice,
  };
}
