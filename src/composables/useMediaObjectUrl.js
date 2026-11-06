// 受保护的素材 → 可直接放进 <img>/<audio>/<video>/<a> 的 blob URL。
//
// 素材下发（/api/puzzle/media/:id、/api/puzzle/asset/...）走取题门禁，必须带
// Authorization 请求头；而原生标签自身发不出这个头（登录的刷新 Cookie 只挂在
// /api/auth 路径上），所以只能由 JS 取回二进制再转成 blob URL。
//
// 缓存按原始路径复用，引用计数归零时释放，避免同一素材被重复下载或过早撤销。
import { computed, onBeforeUnmount, ref, unref, watch } from "vue";
import { fetchWithAuth } from "@/api/request";
import { extractErrorMessage } from "@/api/errors";
import { resolveServerUrl } from "@/config/api";

const cache = new Map();

// 失败记录在缓存里保留多久（毫秒）。
// 保留的意义：同一时刻的多个消费者应当看到同一份结果，不能一个失败一个成功。
// 但不能永久保留，否则一次网络抖动会把这条素材钉死到下次刷新页面。
const FAILED_TTL_MS = 3000;

// ---------- 失败追踪与重试 ----------
// 路径 → 当前处于失败状态的消费者数量。用计数而不是布尔：
// 同一张素材可能被多处渲染，只有它们全部离开失败态才算没问题。
const failedCounts = new Map();
// 供界面判断「要不要显示重试入口」的响应式视图
const failedPaths = ref(new Set());
// 路径 → 各消费者的 reload 句柄，供「重试这批素材」逐个触发
const retryHandlers = new Map();

function syncFailedPaths() {
  failedPaths.value = new Set(failedCounts.keys());
}

function bumpFailed(path, delta) {
  const next = Math.max(0, (failedCounts.get(path) ?? 0) + delta);
  if (next === 0) failedCounts.delete(path);
  else failedCounts.set(path, next);
  syncFailedPaths();
}

function addRetryHandler(path, handler) {
  let set = retryHandlers.get(path);
  if (!set) {
    set = new Set();
    retryHandlers.set(path, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (!set.size && retryHandlers.get(path) === set) retryHandlers.delete(path);
  };
}

// 当前失败中的素材路径（响应式）。界面用它决定是否显示重试入口。
export const failedMediaPaths = computed(() => failedPaths.value);

// 重试失败的素材：paths 为空表示全部；不传则重试所有失败项。
// 只挑「确实处于失败态」的消费者，成功的不重新下载。
export function retryFailedMedia(paths = null) {
  const targets = paths ? new Set(paths) : null;
  for (const [path, handlers] of [...retryHandlers]) {
    if (targets && !targets.has(path)) continue;
    if (!failedCounts.has(path)) continue;
    for (const handler of [...handlers]) handler();
  }
}

// 获取素材的 blob URL，并管理引用计数。
// 返回值是「这条记录」本身：调用方必须持有它，释放时交回来（见 release）。
// fresh=true 用于「用户点重试」：不沿用失败记录，立刻重新发起。
function acquire(path, { fresh = false } = {}) {
  let record = cache.get(path);

  // 失败记录过了保留期：直接作废（定时器可能还没跑到，这里兜底）
  if (record?.failedAt && Date.now() - record.failedAt >= FAILED_TTL_MS) {
    if (cache.get(path) === record) cache.delete(path);
    record = null;
  }
  // 显式重试：失败记录不再复用。成功记录不在这里处理 ——
  // 调用方 clear() 之后引用归零，缓存项已按正常路径释放。
  if (record?.failedAt && fresh) {
    if (cache.get(path) === record) cache.delete(path);
    record = null;
  }

  if (!record) {
    const promise = (async () => {
      const response = await fetchWithAuth(resolveServerUrl(path), {
        headers: { Accept: "*/*" },
      });
      if (!response.ok) {
        // 失败时是标准 JSON 错误体；429 额外带上等待秒数，其余直接用后端文案
        const payload = await response.json().catch(() => null);
        const waitSec = Number(payload?.error?.detail?.retry_after_sec) || 0;
        throw new Error(
          response.status === 429 && waitSec > 0
            ? `请求过于频繁，请 ${waitSec} 秒后再试`
            : extractErrorMessage(payload, `素材加载失败（${response.status}）`),
        );
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    })();
    record = { path, promise, refs: 0, failedAt: 0 };
    cache.set(path, record);
    // 失败先留着（让同时期的消费者看到同一份失败），过了 TTL 再从表里摘掉，
    // 之后挂载的消费者才会重新发起请求
    promise.catch(() => {
      record.failedAt = Date.now();
      setTimeout(() => {
        if (cache.get(path) === record) cache.delete(path);
      }, FAILED_TTL_MS);
    });
  }
  record.refs += 1;
  return record;
}

// 释放「自己持有的那条记录」（不是「当前路径对应的记录」）。
//
// 按路径去缓存里重查是错的：请求失败时缓存项会被删掉，别人重试会建一条新记录，
// 这时旧消费者再按路径释放，减到的是别人的计数，refs 归零后就把别人还在用的
// blob URL 撤销了（图直接裂开，status 却还停在 ready）。
function release(record) {
  if (!record) return;
  record.refs -= 1;
  if (record.refs > 0) return;
  // 只在缓存仍然指向自己时才删表；否则那条是别人的新记录，不归我们管
  if (cache.get(record.path) === record) cache.delete(record.path);
  record.promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
}

// 非组件场景（如 Markdown 正文里的图片）复用同一份缓存与引用计数。
// 与 useMediaObjectUrl 一样持有「记录」而不是路径：释放时必须还回同一条，
// 否则失败重试后可能减到别人新建记录的计数，把还在用的 blob 撤销掉（图直接裂开）。
export function acquireMediaRecord(path, options) {
  return acquire(path, options);
}

export function releaseMediaRecord(record) {
  release(record);
}

// 使用素材的 blob URL 的组合式函数。
// source 可以是字符串、ref，或返回字符串的 getter。
// 返回对象包含：
// - src: blob URL
// - status: idle | loading | ready | error
// - error: 错误信息
// - reload: 重新加载函数
export function useMediaObjectUrl(source) {
  const src = ref("");
  const status = ref("idle"); // idle | loading | ready | error
  const error = ref("");
  // 当前持有的是哪一条记录（不是路径）：释放时必须还回同一条，
  // 否则失败重试后可能减到别人新建记录的计数，把还在用的 blob 撤销掉。
  let activeRecord = null;
  // 释放时要把自己在「失败计数」和「重试句柄」里的登记一起撤掉
  let unregisterRetry = null;
  let failedPath = "";

  // getter 与 ref 都要能读到最新值：unref 只解包 ref，函数需要主动调用。
  const readSource = () =>
    typeof source === "function" ? source() : unref(source);

  function clear() {
    if (unregisterRetry) unregisterRetry();
    unregisterRetry = null;
    if (failedPath) {
      bumpFailed(failedPath, -1);
      failedPath = "";
    }
    if (activeRecord) release(activeRecord);
    activeRecord = null;
    src.value = "";
    status.value = "idle";
    error.value = "";
  }

  async function load(rawPath, { fresh = false } = {}) {
    clear();

    const path = String(rawPath ?? "").trim();
    if (!path) return;

    status.value = "loading";

    const record = acquire(path, { fresh });
    activeRecord = record;
    unregisterRetry = addRetryHandler(path, () => load(path, { fresh: true }));

    try {
      const url = await record.promise;
      // 用记录身份而不是路径判断：A→B→A 这种来回切换时路径会重复，
      // 只比路径会把迟到的旧响应写进新状态。
      if (activeRecord !== record) return;
      src.value = url;
      status.value = "ready";
    } catch (err) {
      if (activeRecord !== record) return;
      error.value = err?.message || "素材加载失败";
      status.value = "error";
      bumpFailed(path, 1);
      failedPath = path;
    }
  }

  watch(readSource, load, { immediate: true });
  onBeforeUnmount(clear);

  return {
    src,
    status,
    error,
    // 用户点「重试」：不沿用失败记录，立刻重新发起一次
    reload: () => load(readSource(), { fresh: true }),
  };
}

export default useMediaObjectUrl;
