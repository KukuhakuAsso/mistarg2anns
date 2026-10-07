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
import { authApi } from "@/api/auth";
import { router } from "@/router";

const STORAGE_KEY = "mistarg2anns:state:v1";

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
      auth: {
        loginFailureCount: 0,
        verificationRequired: false,
        verificationMode: "login",
        generatedCode: "",
        pendingRegister: null,
        pendingLogin: null,
      },
      team: {
        joined: false,
        name: "",
        code: "",
        members: [],
        applications: [],
      },
    },
    ui: {
      cluePanelOpen: true,
      theme: "system", // system | light | dark
    },
  };
}

function isPlacement(item) {
  return (
    Boolean(item) &&
    typeof item.clueId === "string" &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y) &&
    CLUE_BY_ID.has(item.clueId)
  );
}

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

// ---------- 派生状态 ----------

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

const unlockedCount = computed(
  () => folderStates.value.filter((folder) => folder.unlocked).length,
);

const completedCount = computed(() => state.completedFolders.length);

const boardClues = computed(() =>
  state.board
    .map((placement) => {
      const clue = CLUE_BY_ID.get(placement.clueId);
      return clue ? { ...clue, x: placement.x, y: placement.y } : null;
    })
    .filter(Boolean),
);

const poolClues = computed(() => {
  const onBoard = new Set(state.board.map((placement) => placement.clueId));
  return state.discoveredClues
    .filter((clueId) => CLUE_BY_ID.has(clueId) && !onBoard.has(clueId))
    .map((clueId) => CLUE_BY_ID.get(clueId));
});

// ---------- 操作 ----------

function setFolderCompleted(folderId) {
  if (!state.completedFolders.includes(folderId)) {
    state.completedFolders.push(folderId);
  }
  if (!state.visitedFolders.includes(folderId)) {
    state.visitedFolders.push(folderId);
  }
}

function markFolderVisited(folderId) {
  if (!state.visitedFolders.includes(folderId)) {
    state.visitedFolders.push(folderId);
  }
}

function discoverClue(clueId) {
  if (!state.discoveredClues.includes(clueId)) {
    state.discoveredClues.push(clueId);
  }
}

function isClueDiscovered(clueId) {
  return state.discoveredClues.includes(clueId);
}

function isTipUnlocked(tipId) {
  return state.unlockedTips.includes(tipId);
}

function unlockTip(tipId) {
  if (isTipUnlocked(tipId) || state.tipPoints < 1) return false;

  state.tipPoints -= 1;
  state.unlockedTips.push(tipId);
  return true;
}

function placeClue(clueId, x, y) {
  const existing = state.board.find((item) => item.clueId === clueId);
  if (existing) {
    existing.x = x;
    existing.y = y;
    return;
  }
  state.board.push({ clueId, x, y });
}

function removeClueFromBoard(clueId) {
  state.board = state.board.filter((item) => item.clueId !== clueId);
}

function clearBoard() {
  state.board = [];
}

// 按列网格排布，宽度取自板面实际宽度
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

function arrangeBoard(boardWidth) {
  state.board = state.board.map((item, index) => ({
    clueId: item.clueId,
    ...gridPosition(index, boardWidth),
  }));
}

// 不经拖拽的备用入口：直接追加到板面末尾
function addClueToBoard(clueId, boardWidth) {
  const { x, y } = gridPosition(state.board.length, boardWidth);
  placeClue(clueId, x, y);
}

function toggleCluePanel() {
  state.ui.cluePanelOpen = !state.ui.cluePanelOpen;
}

function resetProgress() {
  Object.assign(state, createDefaultState(), { ui: state.ui });
}

function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function resetAuthVerificationState() {
  state.user.auth = {
    loginFailureCount: 0,
    verificationRequired: false,
    verificationMode: "login",
    generatedCode: "",
    pendingRegister: null,
    pendingLogin: null,
  };
}

async function logoutUser() {
  try {
    await authApi.logout();
  } catch (error) {
    // cookie / server session may already be expired; still clear local app state.
  }

  state.user.currentUser = null;
  return { ok: true };
}

function createTeam(teamName, teamCode) {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再创建队伍。" };
  }

  if (state.user.team.joined) {
    return { ok: false, message: "你已经在队伍中，无法重复创建队伍。" };
  }

  const cleanName = String(teamName ?? "").trim();
  const cleanCode = String(teamCode ?? "").trim();

  state.user.team = {
    joined: true,
    name: cleanName || `${state.user.currentUser.nickname || state.user.currentUser.username}的队伍`,
    code: cleanCode || `TM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    members: [
      {
        username: state.user.currentUser.username,
        nickname: state.user.currentUser.nickname,
        role: "队长",
      },
    ],
    applications: [],
  };

  return {
    ok: true,
    message: `队伍创建成功，编号 ${state.user.team.code}。`,
  };
}

function joinTeam(teamCode) {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再加入队伍。" };
  }

  if (state.user.team.joined) {
    return { ok: false, message: "你已经在队伍中。" };
  }

  const cleanCode = String(teamCode ?? "").trim();

  if (!cleanCode) {
    return { ok: false, message: "队伍编号不能为空。" };
  }

  state.user.team = {
    joined: true,
    name: `${state.user.currentUser.nickname || state.user.currentUser.username}的队伍`,
    code: cleanCode,
    members: [
      {
        username: state.user.currentUser.username,
        nickname: state.user.currentUser.nickname,
        role: "成员",
      },
    ],
    applications: [],
  };

  return {
    ok: true,
    message: `已加入队伍 ${cleanCode}。`,
  };
}

function leaveTeam() {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再退出队伍。" };
  }

  if (!state.user.team.joined) {
    return { ok: false, message: "你当前并没有加入任何队伍。" };
  }

  state.user.team = {
    joined: false,
    name: "",
    code: "",
    members: [],
    applications: [],
  };

  return { ok: true, message: "已退出当前队伍。" };
}

function submitTeamApplication(message) {
  if (!state.user.currentUser) {
    return { ok: false, message: "请先登录后再申请组队。" };
  }

  if (!state.user.team.joined) {
    return { ok: false, message: "你当前没有队伍，先创建或加入一个队伍后再申请。" };
  }

  const text = String(message ?? "").trim();
  const alreadyApplied = state.user.team.applications.some(
    (application) =>
      application.username === state.user.currentUser.username &&
      application.status === "pending",
  );

  if (alreadyApplied) {
    return { ok: false, message: "你已经提交过组队申请了。" };
  }

  state.user.team.applications.push({
    id: `req-${Date.now()}`,
    username: state.user.currentUser.username,
    nickname: state.user.currentUser.nickname,
    message: text || "我希望加入队伍，协助完成任务。",
    status: "pending",
  });

  return { ok: true, message: "组队申请已提交。" };
}

function handleTeamApplication(applicationId, action) {
  const application = state.user.team.applications.find(
    (item) => item.id === applicationId,
  );

  if (!application) {
    return { ok: false, message: "申请不存在。" };
  }

  if (action === "accept") {
    const exists = state.user.team.members.some(
      (member) => member.username === application.username,
    );

    if (!exists) {
      state.user.team.members.push({
        username: application.username,
        nickname: application.nickname,
        role: "成员",
      });
    }
  }

  application.status = action === "accept" ? "accepted" : "rejected";
  return { ok: true, message: action === "accept" ? "已接受申请" : "已拒绝申请" };
}

export function useGameState() {
  return {
    state,
    folderStates,
    unlockedCount,
    completedCount,
    boardClues,
    poolClues,
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
    logoutUser,
    createTeam,
    joinTeam,
    leaveTeam,
    submitTeamApplication,
    handleTeamApplication,
  };
}
