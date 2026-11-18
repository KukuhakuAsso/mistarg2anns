// pz-bridge@0.2 的纯逻辑：能力表、快照维护与错误归一化（不依赖 Vue / 网络层）。
//
// 宿主协议实现见 utils/pzBridge.js，挂载与销毁见 composables/usePzBridge.js。
// 这里保持纯函数，便于 tests/pzBridge.test.js 直接覆盖 409 冲突合并、404 降级等分支。

export const PZ_BRIDGE_CONTRACT = "pz-bridge@0.2";

// 三种宿主模式（api-12 §前端实现要点 · 可塑区宿主桥）：
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
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

// 409 PZ_STATE_CONFLICT 的 detail 带真实最新值：用它更新本地快照后再决定是否重试。
// 没有可用的 latest_state 时返回 null（保持原快照，由组件自行 refresh）。
export function applyConflictSnapshot(current, detail) {
  if (!detail || typeof detail !== "object") return null;
  const latestState = detail.latest_state;
  if (!latestState || typeof latestState !== "object" || Array.isArray(latestState)) {
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
  const code = payload?.error?.code || payload?.code || error?.code || "E_UNKNOWN";
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
  return failure?.code === "E_CONFLICT" && failure?.reasonCode === "PZ_STATE_CONFLICT";
}

// 组件按 code / reasonCode 分支，不匹配中文 message，所以固定这几个字段名。
export function createPzError(fields = {}) {
  const error = new Error(fields.message || fields.code || "组件桥调用失败");
  error.name = "PzBridgeError";
  error.code = fields.code || "E_UNKNOWN";
  error.reasonCode = fields.reasonCode ?? null;
  error.status = Number(fields.status) || 0;
  error.retryable = Boolean(fields.retryable);
  error.retryAfterSec = Number(fields.retryAfterSec) > 0 ? Number(fields.retryAfterSec) : 0;
  error.latestRev = Number.isFinite(Number(fields.latestRev)) ? Number(fields.latestRev) : null;
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
