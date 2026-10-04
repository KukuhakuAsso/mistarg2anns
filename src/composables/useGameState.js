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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
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
  };
}
