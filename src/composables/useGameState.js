// 全局游戏状态：档案解锁进度 + 线索栏（已发现线索 / 板面排布）。
// 单例模块，任意组件直接调用 useGameState() 即可读写同一份状态。

import { computed, reactive, watch } from "vue";
import {
  CLUE_BY_ID,
  FOLDERS,
  HIDDEN_FOLDER_ID,
  MAIN_FOLDERS,
} from "@/config/folders";
import { CARD_GAP, CARD_H, CARD_W } from "@/config/board";
import { validateTeamName } from "@/config/team";
import { extractErrorMessage, extractFieldMessage } from "@/api/errors";
import { teamApi } from "@/api/team";
import { messageApi } from "@/api/message";

const STORAGE_KEY = "mistarg2anns:state:v1";

// 生成一份全新的初始状态：所有档案未完成、无发现线索、板面为空、未登录。
function createDefaultState() {
  return {
    completedFolders: [],
    visitedFolders: [],
    discoveredClues: [],
    tipPoints: 3,
    unreadMessages: 0,
    unlockedTips: [],
    board: [],
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

// 校验一条板面排布数据是否合法：必须有有效线索 ID 和有限的坐标。
function isPlacement(item) {
  return (
    Boolean(item) &&
    typeof item.clueId === "string" &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y) &&
    CLUE_BY_ID.has(item.clueId)
  );
}
// 从 localStorage 读取并校验持久化的游戏进度；缺失或损坏时退回初始状态。

function loadState() {
  const fallback = createDefaultState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const saved = JSON.parse(raw);
    return {
      completedFolders: Array.isArray(saved.completedFolders)
        ? saved.completedFolders
        : [],
      visitedFolders: Array.isArray(saved.visitedFolders)
        ? saved.visitedFolders
        : [],
      discoveredClues: Array.isArray(saved.discoveredClues)
        ? saved.discoveredClues
        : [],
      tipPoints:
        Number.isInteger(saved.tipPoints) && saved.tipPoints >= 0
          ? saved.tipPoints
          : fallback.tipPoints,
      unreadMessages:
        Number.isInteger(saved.unreadMessages) && saved.unreadMessages >= 0
          ? saved.unreadMessages
          : fallback.unreadMessages,
      unlockedTips: Array.isArray(saved.unlockedTips)
        ? saved.unlockedTips.filter((tipId) => typeof tipId === "string")
        : [],
      board: Array.isArray(saved.board) ? saved.board.filter(isPlacement) : [],
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
        completedFolders: value.completedFolders,
        visitedFolders: value.visitedFolders,
        discoveredClues: value.discoveredClues,
        tipPoints: value.tipPoints,
        unreadMessages: value.unreadMessages,
        unlockedTips: value.unlockedTips,
        board: value.board,
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
  },
);

// ---------- 派生状态 ----------
//派生：当前已解锁的档案 ID 集合。主线档案依次解锁，隐藏档案在主线全部完成后解锁。
// 解锁规则：主线档案依次解锁，隐藏档案在主线全部完成后解锁
const unlockedFolderIds = computed(() => {
  const unlocked = new Set();

  MAIN_FOLDERS.forEach((folder, index) => {
    const previous = index === 0 ? null : MAIN_FOLDERS[index - 1];
    if (!previous || state.completedFolders.includes(previous.id)) {
      unlocked.add(folder.id);
    }
  });

  if (
    MAIN_FOLDERS.every((folder) => state.completedFolders.includes(folder.id))
  ) {
    unlocked.add(HIDDEN_FOLDER_ID);
  }

  return unlocked;
});

// 派生：把静态档案列表与当前进度合并，生成供界面直接使用的档案状态数组。
const folderStates = computed(() =>
  FOLDERS.map((folder) => ({
    ...folder,
    unlocked: unlockedFolderIds.value.has(folder.id),
    completed: state.completedFolders.includes(folder.id),
    visited: state.visitedFolders.includes(folder.id),
    puzzleCount: folder.entries.filter((entry) => entry.kind === "puzzle")
      .length,
    clueCount: folder.entries.filter((entry) => entry.kind === "clue").length,
  })),
);
// 派生：已解锁档案数量。
const unlockedCount = computed(
  () => folderStates.value.filter((folder) => folder.unlocked).length,
);

// 派生：已完成档案数量。
const completedCount = computed(() => state.completedFolders.length);

// 派生：板面上已放置的线索，附带其坐标。
const boardClues = computed(() =>
  state.board
    .map((placement) => {
      const clue = CLUE_BY_ID.get(placement.clueId);
      return clue ? { ...clue, x: placement.x, y: placement.y } : null;
    })
    .filter(Boolean),
);

// 派生：已发现但尚未放到板面上的线索池。
const poolClues = computed(() => {
  const onBoard = new Set(state.board.map((placement) => placement.clueId));
  return state.discoveredClues
    .filter((clueId) => CLUE_BY_ID.has(clueId) && !onBoard.has(clueId))
    .map((clueId) => CLUE_BY_ID.get(clueId));
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

// 将某个档案标记为已完成，并顺带记录为已访问。
function setFolderCompleted(folderId) {
  if (!state.completedFolders.includes(folderId)) {
    state.completedFolders.push(folderId);
  }
  if (!state.visitedFolders.includes(folderId)) {
    state.visitedFolders.push(folderId);
  }
}

// 仅将某个档案标记为已访问，不影响完成状态。
function markFolderVisited(folderId) {
  if (!state.visitedFolders.includes(folderId)) {
    state.visitedFolders.push(folderId);
  }
}

// 记录一条新发现的线索，重复发现会被忽略。
function discoverClue(clueId) {
  if (!state.discoveredClues.includes(clueId)) {
    state.discoveredClues.push(clueId);
  }
}

// 查询某条线索是否已被发现。
function isClueDiscovered(clueId) {
  return state.discoveredClues.includes(clueId);
}

// 查询某条提示是否已解锁。
function isTipUnlocked(tipId) {
  return state.unlockedTips.includes(tipId);
}

// 消耗 1 点提示点解锁一条提示；已解锁或点数不足时返回 false。
function unlockTip(tipId) {
  if (isTipUnlocked(tipId) || state.tipPoints < 1) return false;

  state.tipPoints -= 1;
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

// 切换线索栏的展开 / 收起状态。
function toggleCluePanel() {
  state.ui.cluePanelOpen = !state.ui.cluePanelOpen;
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

// 刷新未读角标（GET /api/msg/summary），把 total 写入全局状态供顶栏与桌面展示。
// 失败时静默处理，不影响页面主流程。
async function refreshUnreadSummary() {
  if (!state.user.currentUser) {
    state.unreadMessages = 0;
    return { ok: false };
  }

  try {
    const response = await messageApi.getSummary();
    state.unreadMessages = Number(response?.data?.total ?? 0) || 0;
    return { ok: true, total: state.unreadMessages };
  } catch {
    return { ok: false };
  }
}

// 组合式函数入口：任何组件调用都会获得同一份全局状态与同一组操作函数。
export function useGameState() {
  return {
    state,
    folderStates,
    unlockedCount,
    completedCount,
    boardClues,
    poolClues,
    // 队伍派生状态
    currentTeam,
    myJoinRequest,
    isTeamCaptain,
    teamLocked,
    teamPendingRequests,
    setFolderCompleted,
    markFolderVisited,
    discoverClue,
    isClueDiscovered,
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
  };
}
