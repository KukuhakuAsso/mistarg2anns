// pz-bridge@0.2 的宿主实现（不依赖 Vue）：
// 维护组件状态快照、串接 rpc / state 两个接口、处理组件可能抛出的错误
//
// 宿主只负责「拿数据 + 同步快照」：token、API 地址、重试节奏都在这里收口，
// 组件只调 pz.rpc() / pz.refresh() 并读 pz.snapshot()。
import { extractErrorMessage } from "./errors.js";

// ---------- 协议常量与纯逻辑 ----------

export const PZ_BRIDGE_CONTRACT = "pz-bridge@0.2";

// 三种宿主模式：
//   play     —— 正常可读写
//   preview  —— 管理端预览：只读，rpc 直接 reject E_PREVIEW
//   degraded —— 视图没有 runtime（旧后端 / 静态环境）：只能读；没有状态可同步，故不提供 refresh
export const PZ_CAPS = {
  play: { read: true, write: true, refresh: true },
  preview: { read: false, write: false, refresh: true },
  degraded: { read: true, write: false, refresh: false },
};

export function capsForMode(mode) {
  return { ...(PZ_CAPS[mode] || PZ_CAPS.degraded) };
}

// 未显式指定 mode 时按 runtime 是否存在推断：有 runtime 才能写，否则降级只读。
export function resolveBridgeMode(mode, runtime) {
  if (mode === "preview" || mode === "degraded") return mode;
  return runtime && typeof runtime === "object" ? "play" : "degraded";
}

// 跨边界只传纯数据：宿主的响应式对象、函数一律不透传。
export function toPlainData(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function toRevision(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

// state 必须是普通对象：数组 / 标量 / null 一律当空状态。
export function normalizeStateValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function createSnapshot({ rev, state, view = null, server } = {}) {
  const snapshot = {
    rev: toRevision(rev),
    state: normalizeStateValue(toPlainData(state, {})),
    view: toPlainData(view, null),
  };
  if (server !== undefined && server !== null) {
    snapshot.server = toPlainData(server, null);
  }
  return snapshot;
}

// 处理可能存在的版本冲突
export function applyConflictSnapshot(current, detail) {
  if (!detail || typeof detail !== "object") return null;
  const latestState = detail.latest_state;
  if (
    !latestState ||
    typeof latestState !== "object" ||
    Array.isArray(latestState)
  ) {
    return null;
  }
  const next = {
    rev: toRevision(detail.latest_rev, current?.rev ?? 0),
    state: normalizeStateValue(toPlainData(latestState, {})),
    view: current?.view ?? null,
  };
  if (current?.server !== undefined) next.server = current.server;
  return next;
}

// 把请求层抛出的错误摊平成桥要用的字段（错误体可能包在 error.payload 里）。
export function describePzFailure(error) {
  const payload = error?.payload ?? {};
  const code =
    payload?.error?.code || payload?.code || error?.code || "E_UNKNOWN";
  const detail = payload?.error?.detail ?? payload?.detail ?? {};
  const status = Number(error?.status) || 0;
  return {
    code,
    reasonCode: detail?.reason_code ?? null,
    detail,
    status,
    retryAfterSec: Number(detail?.retry_after_sec) || 0,
    latestRev: detail?.latest_rev,
    latestState: detail?.latest_state,
    reqId: payload?.req_id ?? null,
  };
}

// 可重试：网络层失败、5xx、限流（按秒等待后）、状态版本冲突（快照已更新，可基于新状态重做）。
// 400 / 403 / 404 / STATE_VERSION_UNSUPPORTED 重试没有意义，交给组件降级或换交互。
export function isRetryableFailure(failure) {
  const status = Number(failure?.status) || 0;
  if (status === 0) return true;
  if (status >= 500) return true;
  if (status === 429) return true;
  return (
    failure?.code === "E_CONFLICT" &&
    failure?.reasonCode === "PZ_STATE_CONFLICT"
  );
}

// 组件按 code / reasonCode 分支，不匹配中文 message，所以固定这几个字段名。
export function createPzError(fields = {}) {
  const error = new Error(fields.message || fields.code || "组件桥调用失败");
  error.name = "PzBridgeError";
  error.code = fields.code || "E_UNKNOWN";
  error.reasonCode = fields.reasonCode ?? null;
  error.status = Number(fields.status) || 0;
  error.retryable = Boolean(fields.retryable);
  error.retryAfterSec =
    Number(fields.retryAfterSec) > 0 ? Number(fields.retryAfterSec) : 0;
  error.latestRev = Number.isFinite(Number(fields.latestRev))
    ? Number(fields.latestRev)
    : null;
  error.snapshotUpdated = Boolean(fields.snapshotUpdated);
  error.refreshFailed = Boolean(fields.refreshFailed);
  error.reqId = fields.reqId ?? null;
  return error;
}

export function isPzError(error) {
  return error?.name === "PzBridgeError";
}

// 服务端要求 8–128 位字母数字 / .=_~-，UUID 天然满足。
export function createIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let index = 0; index < 32; index += 1) {
    key += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return key;
}

// 网络层失败（没有 HTTP 状态）说明请求可能没到服务端，用同一个 Idempotency-Key 重试一次。
const NETWORK_RETRY_DELAY_MS = 200;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createPzBridge({
  puzzleKey = "",
  mode = "",
  runtime = null,
  view = null,
  callRpc,
  callState,
  retryDelayMs = NETWORK_RETRY_DELAY_MS,
} = {}) {
  let disposed = false;
  // 404 RPC_UNSUPPORTED / PUZZLE_UNAVAILABLE 后长期降级只读，不再反复试探
  let degraded = false;
  let bridgeMode = resolveBridgeMode(mode, runtime);
  let current = createSnapshot({
    rev: runtime?.rev,
    state: runtime?.state,
    view,
  });
  // 组件实现的组件回调不能影响宿主：单个组件抛错只丢弃这次回调
  const subscribers = new Set();
  // 切题 / 卸载时中断在飞请求，避免迟到响应写回旧题目的快照
  const controller = new AbortController();
  let pendingRefresh = null;

  const modeNow = () => (degraded ? "degraded" : bridgeMode);
  const capsNow = () => capsForMode(modeNow());
  const snapshot = () => ({ ...current });
  const staleError = () =>
    createPzError({
      code: "E_STALE",
      message: "组件已卸载或题目已切换",
      retryable: false,
    });

  function emit() {
    const snap = snapshot();
    for (const callback of [...subscribers]) {
      try {
        callback(snap);
      } catch {
        // 组件的回调错误不能反向影响宿主
      }
    }
  }

  function degrade() {
    if (degraded) return;
    degraded = true;
    // 能力变化也要通知：组件按 pz.caps 决定是否隐藏状态交互
    emit();
  }

  function onPatch(callback) {
    if (typeof callback !== "function") return () => {};
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  function setView(next) {
    if (disposed) return;
    const plain = toPlainData(next, null);
    if (plain === null) return;
    current = { ...current, view: plain };
  }

  // 视图重新拉回 runtime 时同步快照；rev / state 变化要通知组件（可能是队友写入）。
  function hydrateRuntime(next) {
    if (disposed || !next || typeof next !== "object") return;
    if (mode === "preview" || bridgeMode === "preview") return;

    const previousMode = modeNow();
    const rev = toRevision(next.rev);
    const state = normalizeStateValue(next.state);
    const changed =
      rev !== current.rev ||
      JSON.stringify(state) !== JSON.stringify(current.state);
    current = { ...current, rev, state };
    if (!degraded) bridgeMode = "play";
    if (changed || previousMode !== modeNow()) emit();
  }

  // 服务端错误 → 组件可见的错误对象；顺带完成快照修复与降级。
  async function toBridgeError(failure, cause, extra = {}) {
    let snapshotUpdated = false;
    if (failure.reasonCode === "PZ_STATE_CONFLICT") {
      const next = applyConflictSnapshot(current, failure.detail);
      if (next) {
        current = next;
        snapshotUpdated = true;
        emit();
      }
    }

    if (
      failure.status === 404 &&
      (failure.reasonCode === "RPC_UNSUPPORTED" ||
        failure.reasonCode === "PUZZLE_UNAVAILABLE")
    ) {
      degrade();
    }

    let refreshFailed = Boolean(extra.refreshFailed);
    if (failure.reasonCode === "STATE_VERSION_UNSUPPORTED") {
      // 状态结构版本不兼容：只刷新快照，不重放这次写入
      try {
        await refresh();
      } catch {
        refreshFailed = true;
      }
    }

    return createPzError({
      code: failure.code,
      reasonCode: failure.reasonCode,
      status: failure.status,
      retryable: isRetryableFailure(failure),
      retryAfterSec: failure.retryAfterSec,
      latestRev:
        failure.reasonCode === "PZ_STATE_CONFLICT" ? failure.latestRev : null,
      snapshotUpdated,
      refreshFailed,
      reqId: failure.reqId,
      message: extractErrorMessage(cause, "组件状态同步失败"),
    });
  }

  async function rpc(method, payload, rev) {
    if (disposed) throw staleError();
    if (modeNow() === "preview") {
      throw createPzError({
        code: "E_PREVIEW",
        message: "预览模式下不能写入组件状态",
        retryable: false,
      });
    }
    if (!capsNow().write) {
      throw createPzError({
        code: "E_READ_ONLY",
        message: "当前为只读模式，不能写入组件状态",
        retryable: false,
      });
    }
    if (typeof callRpc !== "function") {
      throw createPzError({
        code: "E_UNSUPPORTED",
        message: "宿主未提供 rpc 能力",
        retryable: false,
      });
    }
    if (typeof method !== "string" || !method.trim()) {
      throw createPzError({
        code: "E_VALIDATION",
        reasonCode: "INVALID_BODY",
        message: "缺少 method",
        retryable: false,
      });
    }

    const body = {
      method,
      payload: toPlainData(payload, {}) ?? {},
      rev: toRevision(rev, current.rev),
    };
    // 每次调用一个新的幂等键；同一次调用的网络重试必须复用它
    const idempotencyKey = createIdempotencyKey();

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await callRpc(puzzleKey, body, {
          idempotencyKey,
          signal: controller.signal,
        });
        if (disposed) throw staleError();

        const data = response?.data ?? {};
        current = {
          ...current,
          rev: toRevision(data.rev, current.rev),
          state: normalizeStateValue(data.state),
        };
        emit();

        const result = {
          rev: current.rev,
          prevRev: toRevision(data.prevRev, body.rev),
          state: { ...current.state },
        };
        // data / toast 只有平台方法才可能有，按字段存在性判断
        if (data.data !== undefined) result.data = data.data;
        if (data.toast !== undefined && data.toast !== null)
          result.toast = data.toast;
        return result;
      } catch (error) {
        if (disposed || isPzError(error)) throw error;

        const failure = describePzFailure(error);
        if (!failure.status && attempt === 0) {
          await delay(retryDelayMs);
          continue;
        }
        throw await toBridgeError(failure, error);
      }
    }
  }

  function refresh() {
    if (disposed) return Promise.reject(staleError());
    if (!capsNow().refresh) {
      return Promise.reject(
        createPzError({
          code: "E_UNSUPPORTED",
          message: "当前模式不支持刷新组件状态",
          retryable: false,
        }),
      );
    }
    if (typeof callState !== "function") {
      return Promise.reject(
        createPzError({
          code: "E_UNSUPPORTED",
          message: "宿主未提供状态读取能力",
          retryable: false,
        }),
      );
    }
    // 并发去重：多个组件 / 多次点击共享同一次轻量读
    if (pendingRefresh) return pendingRefresh;

    pendingRefresh = (async () => {
      try {
        const response = await callState(puzzleKey, {
          signal: controller.signal,
        });
        if (disposed) throw staleError();

        const data = response?.data ?? {};
        current = {
          rev: toRevision(data.rev, current.rev),
          state: normalizeStateValue(data.state),
          view: current.view,
        };
        // server 是平台方法派生的投影，没有投影时字段不出现（auth_state 永不下发）
        if (data.server !== undefined && data.server !== null) {
          current = { ...current, server: toPlainData(data.server, null) };
        }
        emit();
        return snapshot();
      } catch (error) {
        if (disposed || isPzError(error)) throw error;

        const failure = describePzFailure(error);
        if (failure.status === 404) degrade();
        throw createPzError({
          code: failure.code,
          reasonCode: failure.reasonCode,
          status: failure.status,
          retryable: isRetryableFailure(failure),
          retryAfterSec: failure.retryAfterSec,
          reqId: failure.reqId,
          refreshFailed: true,
          message: extractErrorMessage(error, "组件状态刷新失败"),
        });
      } finally {
        pendingRefresh = null;
      }
    })();

    return pendingRefresh;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    subscribers.clear();
    controller.abort();
  }

  return {
    contract: PZ_BRIDGE_CONTRACT,
    puzzleKey,
    get mode() {
      return modeNow();
    },
    get caps() {
      return capsNow();
    },
    get disposed() {
      return disposed;
    },
    snapshot,
    onPatch,
    rpc,
    refresh,
    hydrateRuntime,
    setView,
    dispose,
  };
}
