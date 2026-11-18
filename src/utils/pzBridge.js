// pz-bridge@0.2 的宿主实现（不依赖 Vue，便于单测）：
// 维护组件状态快照、串接 rpc / state 两个接口、把服务端错误归一成组件可分支的形状。
//
// 宿主只负责「拿数据 + 同步快照」：token、API 地址、重试节奏都在这里收口，
// 组件只调 pz.rpc() / pz.refresh() 并读 pz.snapshot()。
import { extractErrorMessage } from "../api/errors.js";
import {
  PZ_BRIDGE_CONTRACT,
  applyConflictSnapshot,
  capsForMode,
  createIdempotencyKey,
  createPzError,
  createSnapshot,
  describePzFailure,
  isPzError,
  isRetryableFailure,
  normalizeStateValue,
  resolveBridgeMode,
  toPlainData,
  toRevision,
} from "./pzBridgeCore.js";

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
  let current = createSnapshot({ rev: runtime?.rev, state: runtime?.state, view });
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
      rev !== current.rev || JSON.stringify(state) !== JSON.stringify(current.state);
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
        if (data.toast !== undefined && data.toast !== null) result.toast = data.toast;
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
