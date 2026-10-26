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
    board: [],
    boardLabels: {},
    // 线索栏服务端快照（api-13）：clueId → { x, y, removed }，只用于算差量，不持久化 ——
    // 每次登录都重新 GET，避免把上一个账号的状态当成「已知服务端状态」。
    serverBoard: {},
    // 待上传的移除墓碑：只有「从收藏里删掉」才产生（拖出板面只是回到待用区）。
    removedClues: [],
    // 本机主动拖出板面的卡片：服务端只有「在板上」一种状态，这类改动不上传，
    // 但要记住，免得下次 GET 又把它们摆回板上。
    unplacedClues: [],
    // 被服务端以 E_VALIDATION 拒过的条目（clueId → 签名）：不重发同一份数据，
    // 等用户把它改成别的坐标 / 重新收藏才会再次尝试。
    rejectedClueBoard: {},
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
    // 老存档没有 cover 字段，归一化成 null（渲染时回退占位图）。
    const boardLabels =
      saved.boardLabels && typeof saved.boardLabels === "object"
        ? Object.fromEntries(
            Object.entries(saved.boardLabels)
              .filter(
                ([id, value]) =>
                  typeof id === "string" &&
                  Boolean(value) &&
                  typeof value.title === "string",
              )
              .map(([id, value]) => [
                id,
                {
                  title: value.title,
                  subtitle:
                    typeof value.subtitle === "string" ? value.subtitle : "",
                  cover: toCover(value.cover),
                },
              ]),
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
      board: Array.isArray(saved.board)
        ? saved.board.filter((item) => isPlacement(item, boardLabels))
        : [],
      // 待上传的墓碑与「拖出板面」标记要跨刷新保留，否则改动会丢
      removedClues: Array.isArray(saved.removedClues)
        ? saved.removedClues.filter((id) => typeof id === "string")
        : [],
      unplacedClues: Array.isArray(saved.unplacedClues)
        ? saved.unplacedClues.filter((id) => typeof id === "string")
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
        board: value.board,
        boardLabels: value.boardLabels,
        removedClues: value.removedClues,
        unplacedClues: value.unplacedClues,
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
// 上一个活跃账号：用来区分「登出」和「换账号」—— 后者必须把线索栏也清掉。
let lastAccountKey = null;

watch(
  () => state.user.currentUser?.id ?? state.user.currentUser?.username ?? null,
  (accountKey) => {
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
    // 线索栏现在是账号级数据（服务端快照）：换成另一个账号时清掉上一个账号的卡片，
    // 否则会把 A 的卡片带进 B 的会话，下一次上传还会写进 B 的快照。
    // 单纯登出（→ null）只作废内存里的服务端快照，重新登录同一账号时本地坐标仍能参与合并。
    if (accountKey && lastAccountKey && accountKey !== lastAccountKey) {
      resetClueBoardLocal();
    } else if (!accountKey) {
      resetClueBoardSync();
    }
    lastAccountKey = accountKey;
  },
);

// ---------- 派生状态 ----------

// 派生：板面上已放置的卡片，附带其坐标（标题来自 boardLabels 快照）。
// 快照缺失（跨设备同步过来、本机还没拿到 map）时用 clue_id 兜底，
// 否则卡片会被整条过滤掉 —— 看起来像是同步丢了。
const boardClues = computed(() =>
  state.board
    .map((placement) => {
      const label = state.boardLabels?.[placement.clueId];
      return {
        id: placement.clueId,
        kind: "puzzle",
        title: label?.title ?? placement.clueId,
        folderName: label?.subtitle ?? "",
        cover: label?.cover ?? null,
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
      cover: label.cover ?? null,
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

// 封面快照只留渲染需要的字段，别把整条 map 数据塞进 localStorage。
function toCover(value) {
  const url = typeof value?.url === "string" ? value.url : "";
  if (!url) return null;
  return { url, alt: typeof value.alt === "string" ? value.alt : "" };
}

// 从数组里就地删掉某个 id（这些集合都是 string[]，靠 includes 判断）。
function dropFrom(list, id) {
  if (!Array.isArray(list)) return;
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1);
}

// 记录一张「从档案拖进板面的题目」卡片的标题快照。
// 板面只存 id + 坐标，标题、来源与封面存在这里：题目来自服务端 map，
// 靠这份快照才能在脱离 map 时（刷新、换页）照常渲染板面卡片。
// createIfMissing=false 时只更新已存在的快照（用于「解出后换完成态封面」）——
// 否则解一道从没拖过的题，它会自己跑进待用区。
function registerBoardCard(
  { id, title, subtitle, cover } = {},
  { createIfMissing = true } = {},
) {
  if (!id || !title) return;
  if (!createIfMissing && !state.boardLabels?.[id]) return;
  state.boardLabels = {
    ...state.boardLabels,
    [id]: { title, subtitle: subtitle || "", cover: toCover(cover) },
  };
  // 重新收进线索栏的卡不再是墓碑，也不算「拖出板面」
  dropFrom(state.removedClues, id);
  dropFrom(state.unplacedClues, id);
}

// 从收藏里彻底移除一张卡（待用区的删除按钮、或卡片上的移除）：
// board 与 boardLabels 必须一起删，否则 boardLabels 里会留下再也看不到的孤儿条目。
// 同时记一条移除墓碑：服务端只有「在板上 / 已移除」两种状态，删卡必须显式上传（api-13）。
function uncollectCard(cardId) {
  if (!cardId) return;
  state.board = state.board.filter((item) => item.clueId !== cardId);
  const labels = { ...(state.boardLabels ?? {}) };
  delete labels[cardId];
  state.boardLabels = labels;
  dropFrom(state.unplacedClues, cardId);
  if (!state.removedClues.includes(cardId)) state.removedClues.push(cardId);
}

// 预置提示购买成功后，用响应里的 balance 就地更新余额角标（省一次 /tips/balance）。
function applyTipsBalance(balance) {
  const value = Number(balance);
  if (!Number.isFinite(value)) return;
  state.teamTips = { ...state.teamTips, hasTeam: true, balance: value };
}

// 在指定坐标放置一条线索；若该线索已在板面则仅更新其坐标。
function placeClue(clueId, x, y) {
  dropFrom(state.unplacedClues, clueId);
  dropFrom(state.removedClues, clueId);
  const existing = state.board.find((item) => item.clueId === clueId);
  if (existing) {
    existing.x = x;
    existing.y = y;
    return;
  }
  state.board.push({ clueId, x, y });
}

// 从板面移除一条线索（回到待用区）。这不是「删除收藏」，所以不产生移除墓碑；
// 但要记进 unplacedClues，否则下一次 GET 会按服务端坐标把它摆回板上。
function removeClueFromBoard(clueId) {
  state.board = state.board.filter((item) => item.clueId !== clueId);
  if (!state.unplacedClues.includes(clueId)) state.unplacedClues.push(clueId);
}

// 清空板面上的所有线索（全部回到待用区，理由同上）。
function clearBoard() {
  for (const item of state.board) {
    if (!state.unplacedClues.includes(item.clueId)) {
      state.unplacedClues.push(item.clueId);
    }
  }
  state.board = [];
}

// ---------- 线索栏快照同步（api-13） ----------

// 把服务端快照校正进本地线索栏。规则（与推荐时序一致）：
//   · removed:true  → 删掉卡片（board + 标题快照 + 两个标记集合）
//   · removed:false → 本机有未上传的改动就保留本地坐标；本机没有这张卡就按服务端坐标补上
// 服务端只有「在板上」一种状态，本机「拖出板面」的卡靠 unplacedClues 挡住，不被摆回去。
function applyClueBoardSnapshot(items = []) {
  const previous = state.serverBoard ?? {};
  const nextServer = {};
  const nextRemoved = new Set(state.removedClues ?? []);
  const unplaced = new Set(state.unplacedClues ?? []);
  const rejected = { ...(state.rejectedClueBoard ?? {}) };
  const labels = { ...(state.boardLabels ?? {}) };
  const board = state.board.map((item) => ({ ...item }));
  const byId = new Map(board.map((item) => [item.clueId, item]));

  for (const item of items) {
    const clueId = item?.clue_id;
    if (typeof clueId !== "string" || !clueId) continue;

    const server = {
      x: Number.isFinite(item.x) ? item.x : null,
      y: Number.isFinite(item.y) ? item.y : null,
      removed: Boolean(item.removed),
    };
    nextServer[clueId] = server;

    if (server.removed) {
      // 服务端已确认移除：墓碑完成任务，本地卡片一并消失
      nextRemoved.delete(clueId);
      unplaced.delete(clueId);
      delete rejected[clueId];
      delete labels[clueId];
      const local = byId.get(clueId);
      if (local) {
        board.splice(board.indexOf(local), 1);
        byId.delete(clueId);
      }
      continue;
    }

    if (nextRemoved.has(clueId)) continue; // 本机刚删掉，等服务端确认，别复活
    if (unplaced.has(clueId)) continue; // 本机故意拖出板面

    const local = byId.get(clueId);
    if (!local) {
      if (server.x === null || server.y === null) continue;
      const placed = { clueId, x: server.x, y: server.y };
      board.push(placed);
      byId.set(clueId, placed);
      continue;
    }

    const known = previous[clueId];
    // 本地坐标与「上次已知的服务端坐标」不一致 = 本机还没上传的移动，保留本地
    const localChanged =
      !known ||
      known.removed ||
      known.x !== Math.round(local.x) ||
      known.y !== Math.round(local.y);
    if (!localChanged && server.x !== null && server.y !== null) {
      local.x = server.x;
      local.y = server.y;
    }
    // 服务端坐标与本地一致 = 这条已经被接受，之前 400 的拒绝记录作废
    if (server.x === Math.round(local.x) && server.y === Math.round(local.y)) {
      delete rejected[clueId];
    }
  }

  state.board = board;
  state.boardLabels = labels;
  state.serverBoard = nextServer;
  state.removedClues = [...nextRemoved];
  state.unplacedClues = [...unplaced];
  state.rejectedClueBoard = rejected;
}

// 本地与「已知服务端状态」的差异，按 api-13 的增量语义拼成 items：
// 只有本地新增/移动的坐标，以及显式删除的墓碑；没出现的线索不会被删除。
// 被服务端拒绝过的同一份数据不再重发，否则每次冷却结束都会重复撞同一个 400。
function pendingClueBoardChanges() {
  const items = [];
  const known = state.serverBoard ?? {};
  const rejected = state.rejectedClueBoard ?? {};

  for (const placement of state.board) {
    const x = Math.round(placement.x);
    const y = Math.round(placement.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const signature = `${x},${y}`;
    if (rejected[placement.clueId] === signature) continue;
    const server = known[placement.clueId];
    if (!server || server.removed || server.x !== x || server.y !== y) {
      items.push({ clue_id: placement.clueId, x, y });
    }
  }

  for (const clueId of state.removedClues ?? []) {
    if (rejected[clueId] === "removed") continue;
    // 本地已在板上的不会再进墓碑集合，这里只补服务端还不知道的移除
    if (!known[clueId] || !known[clueId].removed) {
      items.push({ clue_id: clueId, removed: true });
    }
  }

  return items;
}

// 服务端判定这批条目非法（400 E_VALIDATION）时记下签名，避免反复重发。
// 用户再把卡片挪到别的坐标就是新数据，会重新尝试。
function markClueBoardRejected(items = []) {
  const rejected = { ...(state.rejectedClueBoard ?? {}) };
  for (const item of items) {
    if (typeof item?.clue_id !== "string") continue;
    rejected[item.clue_id] = item.removed ? "removed" : `${item.x},${item.y}`;
  }
  state.rejectedClueBoard = rejected;
}

// 跨设备同步过来的卡片只有 clue_id（boardLabels 不同步）：用 map 里的题目标题补快照，
// 否则板面上只能显示 key。只补「已经在板面上」的卡片 —— 否则所有题目都会跑进待用区。
function hydrateBoardLabels(entries = []) {
  const onBoard = new Set(state.board.map((item) => item.clueId));
  const labels = { ...(state.boardLabels ?? {}) };
  let changed = false;

  for (const entry of entries) {
    const id = entry?.id;
    if (!id || !entry.title) continue;
    if (!onBoard.has(id) || labels[id]) continue;
    labels[id] = {
      title: entry.title,
      subtitle: entry.subtitle || "",
      cover: toCover(entry.cover),
    };
    changed = true;
  }

  if (changed) state.boardLabels = labels;
}

// 登出 / 换账号：服务端快照与墓碑都作废（不持久化，重新登录再拉）。
function resetClueBoardSync() {
  state.serverBoard = {};
  state.removedClues = [];
  state.unplacedClues = [];
  state.rejectedClueBoard = {};
}

// 换成另一个账号：上一个账号的卡片不能留在界面里，更不能被上传进新账号的快照。
function resetClueBoardLocal() {
  state.board = [];
  state.boardLabels = {};
  resetClueBoardSync();
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
    uncollectCard,
    applyTipsBalance,
    placeClue,
    removeClueFromBoard,
    clearBoard,
    arrangeBoard,
    addClueToBoard,
    // 线索栏快照（api-13）
    applyClueBoardSnapshot,
    pendingClueBoardChanges,
    markClueBoardRejected,
    hydrateBoardLabels,
    resetClueBoardSync,
    resetClueBoardLocal,
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
