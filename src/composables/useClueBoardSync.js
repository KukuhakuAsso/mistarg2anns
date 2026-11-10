// 线索栏快照的同步编排（api-13）。
//
// 服务端限流是「同账号 5 分钟一次 POST」，所以本地改动先落到 state（不阻塞 UI），
// 冷却到点再批量上传；上传前必先 GET 合并，避免拿旧坐标覆盖别台设备刚做的改动。
//
// 触发时机（由 App.vue 挂）：
//   · 登录 / 切账号 → pull()（GET 不限流）
//   · 页面重新可见 → pull() + flush()
//   · 本地板面一改 → scheduleFlush()（3 秒防抖，冷却没到就什么都不发）
import { clueBoardApi } from "@/api/clueBoard";
import { describeDevice } from "@/utils/device";
import { useGameState } from "./useGameState";
import { usePuzzleMap } from "./usePuzzleMap";

// 5 分钟冷却，留 5 秒余量，免得刚好卡在边界上被判 429
const UPLOAD_COOLDOWN_MS = 5 * 60 * 1000;
const FLUSH_DEBOUNCE_MS = 3000;

// api-13 的 clue_id 规则：字母/数字开头，可含 _ . : -，1–64 位
const CLUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const MAX_COORD = 100000;
// 单次上传上限 500 条；本地板面远小于这个数，超了宁可分批也别被 400
const MAX_ITEMS = 500;

// 先按契约把明显不合法的条目挑掉：它们发上去只会换来一个 400，
// 而且会让整批（包括合法条目）被拒。坐标取整并夹到 0–100000。
function sanitizeItems(items) {
  const out = [];
  for (const item of items) {
    const clueId = String(item?.clue_id ?? "");
    if (!CLUE_ID_RE.test(clueId)) continue;
    if (item.removed) {
      out.push({ clue_id: clueId, removed: true });
      continue;
    }
    const x = Math.round(Number(item.x));
    const y = Math.round(Number(item.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x > MAX_COORD || y > MAX_COORD) continue;
    out.push({ clue_id: clueId, x, y });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// 下一次允许 POST 的时刻（**按账号**记录：服务端限流是「同账号 5 分钟一次」，
// A 传完不该把 B 也冷却掉）
const cooldownUntil = new Map();
let pullTask = null;
let flushTask = null;
let flushTimer = null;

// 会话代次：reset()（登出 / 换账号）时 +1。
// 在飞的 pull / flush 每个 await 之后都要比对：代次变了说明结果属于上一个账号，
// 不能再写 state、markClueBoardRejected 或改冷却窗口。
let sessionEpoch = 0;

// 读取账号标识，用来判断异步响应回来时是否已经换了账号
function accountKeyOf(state) {
  const user = state.user.currentUser;
  if (!user) return null;
  return user.id ?? user.username ?? null;
}

// 冷却窗口按账号取；没有记录 = 可以立即上传
function cooldownAt(accountKey) {
  if (accountKey === null || accountKey === undefined) return 0;
  return cooldownUntil.get(String(accountKey)) ?? 0;
}

function setCooldown(accountKey, at) {
  if (accountKey === null || accountKey === undefined) return;
  if (!at) cooldownUntil.delete(String(accountKey));
  else cooldownUntil.set(String(accountKey), at);
}

export function useClueBoardSync() {
  const {
    state,
    applyClueBoardSnapshot,
    pendingClueBoardChanges,
    markClueBoardRejected,
    hydrateBoardLabels,
    resetClueBoardSync,
  } = useGameState();
  const { folders } = usePuzzleMap();

  // 用 map 里的题目标题补齐同步过来的卡片快照（boardLabels 不同步）
  function hydrateFromMap() {
    const entries = [];
    for (const folder of folders.value ?? []) {
      for (const entry of folder.entries ?? []) {
        entries.push({
          id: entry.id,
          title: entry.title,
          subtitle: folder.name,
          cover: entry.cover,
        });
      }
    }
    hydrateBoardLabels(entries);
  }

  // 拉取服务端快照并校正本地（不做任何上传）
  async function pull() {
    if (!state.user.currentUser) return { ok: false };
    if (pullTask) return pullTask;

    const accountKey = accountKeyOf(state);
    const epoch = sessionEpoch;
    const task = (async () => {
      try {
        const payload = await clueBoardApi.getSnapshot();
        // 期间登出 / 换账号：这份快照属于上一个账号，直接丢弃
        if (epoch !== sessionEpoch) return { ok: false, stale: true };
        if (accountKey !== accountKeyOf(state)) return { ok: false, stale: true };
        applyClueBoardSnapshot(payload?.data?.items ?? []);
        hydrateFromMap();
        return { ok: true };
      } catch (error) {
        // 失败时本地状态照常可用，下次可见 / 登录再试
        if (epoch !== sessionEpoch) return { ok: false, stale: true };
        return { ok: false, error };
      }
    })();

    pullTask = task;
    try {
      return await task;
    } finally {
      // 只清自己这一次：reset() 已经把引用置空时，这里不会再误清新会话的任务
      if (pullTask === task) pullTask = null;
    }
  }

  // 上传本机差异。force 用于「用户主动点上传」：跳过本地冷却窗口，
  // 服务端 5 分钟限流仍然生效（429 时按 Retry-After 顺延）。
  async function flush({ force = false } = {}) {
    if (!state.user.currentUser) return { ok: false };

    const accountKey = accountKeyOf(state);
    if (flushTask) return flushTask;
    if (!force && Date.now() < cooldownAt(accountKey)) {
      return {
        ok: false,
        throttled: true,
        retryAfterMs: cooldownAt(accountKey) - Date.now(),
      };
    }

    const epoch = sessionEpoch;
    const task = (async () => {
      // 先 GET 合并：只上传「本地与最近一次已知服务端快照的差异」（api-13 §四）
      const pulled = await pull();
      if (!pulled.ok) return pulled;
      // 这个 await 期间可能已经登出 / 换账号：后续一律不能落到新会话上
      if (epoch !== sessionEpoch) return { ok: false, stale: true };
      if (accountKey !== accountKeyOf(state)) return { ok: false, stale: true };

      const items = sanitizeItems(pendingClueBoardChanges());
      if (!items.length) return { ok: true, uploaded: 0 };

      try {
        const payload = await clueBoardApi.putSnapshot({
          device: describeDevice(),
          items,
        });
        // 写回前再比一次代次与账号：响应属于旧会话就整份丢弃
        if (epoch !== sessionEpoch) return { ok: false, stale: true };
        if (accountKey !== accountKeyOf(state)) return { ok: false, stale: true };
        // 响应是合并后的全量快照，直接当作新的「已知服务端状态」
        applyClueBoardSnapshot(payload?.data?.items ?? []);
        hydrateFromMap();
        setCooldown(accountKey, Date.now() + UPLOAD_COOLDOWN_MS);
        return { ok: true, uploaded: items.length };
      } catch (error) {
        // 旧会话的失败不能影响新会话：不写冷却、不标拒绝
        if (epoch !== sessionEpoch) return { ok: false, stale: true };
        if (error?.status === 429) {
          const retry = Number(error.payload?.error?.detail?.retry_after_sec);
          const seconds = Number.isFinite(retry) && retry > 0 ? retry : 300;
          setCooldown(accountKey, Date.now() + seconds * 1000);
          return { ok: false, retryAfter: seconds };
        }
        if (error?.status === 400) {
          // 校验失败：把这批条目标成「已拒绝」，冷却结束后不再重发同一份数据，
          // 等用户把卡片挪到新坐标再试（坐标变化就是新数据）
          console.warn(
            "[mistarg2anns] 线索栏快照被拒绝，本次改动暂不重试",
            error?.message,
          );
          markClueBoardRejected(items);
          setCooldown(accountKey, Date.now() + UPLOAD_COOLDOWN_MS);
          return { ok: false, rejected: true };
        }
        return { ok: false, error };
      }
    })();

    flushTask = task;
    try {
      return await task;
    } finally {
      if (flushTask === task) flushTask = null;
    }
  }

  // 本地一改就排一次上传：冷却没到的话 flush 会立刻返回，本地状态照常可用。
  // 只有真的存在差异才排队 —— applyClueBoardSnapshot 每次都会整体替换 board，
  // 不判断差异的话「应用快照 → 触发 watch → 3 秒后 flush → 再应用快照」会变成定时 GET 循环。
  function scheduleFlush() {
    if (!state.user.currentUser) return;
    if (!pendingClueBoardChanges().length) return;
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  // 登出 / 换账号：作废排队的上传、共享任务与内存快照。
  // 代次 +1 是关键：在飞的 pull / flush 回来后会发现自己是旧会话，
  // 不再写 state、不再改冷却窗口，也不会被新会话复用（否则 B 拿到 A 的任务、
  // 结果被账号检查丢掉，B 的板面要等下一次切标签页才恢复）。
  function reset() {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    sessionEpoch += 1;
    pullTask = null;
    flushTask = null;
    resetClueBoardSync();
  }

  // 距下一次可上传还有多少毫秒（0 = 现在就能传）。给界面显示冷却状态用。
  function cooldownRemaining() {
    return Math.max(0, cooldownAt(accountKeyOf(state)) - Date.now());
  }

  return {
    pull,
    flush,
    scheduleFlush,
    reset,
    hydrateFromMap,
    cooldownRemaining,
  };
}

export default useClueBoardSync;
