// 受保护的素材 → 可直接放进 <img>/<audio>/<video>/<a> 的 blob URL。
//
// 素材下发（/api/puzzle/media/:id、/api/puzzle/asset/...）走取题门禁，必须带
// Authorization 请求头；而原生标签自身发不出这个头（登录的刷新 Cookie 只挂在
// /api/auth 路径上），所以只能由 JS 取回二进制再转成 blob URL。
//
// 缓存按原始路径复用，引用计数归零时释放，避免同一素材被重复下载或过早撤销。
import { onBeforeUnmount, ref, unref, watch } from "vue";
import { fetchWithAuth } from "@/api/request";
import { extractErrorMessage } from "@/api/errors";
import { resolveServerUrl } from "@/config/api";

const cache = new Map();

// 获取素材的 blob URL，并管理引用计数。
function acquire(path) {
  let record = cache.get(path);
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
    record = { promise, refs: 0 };
    cache.set(path, record);
    // 失败不要留在缓存里，下次重试要重新发起
    promise.catch(() => {
      if (cache.get(path) === record) cache.delete(path);
    });
  }
  record.refs += 1;
  return record;
}

// 释放素材的 blob URL，并管理引用计数。
function release(path) {
  const record = cache.get(path);
  if (!record) return;
  record.refs -= 1;
  if (record.refs > 0) return;
  cache.delete(path);
  record.promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
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
  let activePath = "";

  // getter 与 ref 都要能读到最新值：unref 只解包 ref，函数需要主动调用。
  const readSource = () =>
    typeof source === "function" ? source() : unref(source);

  function clear() {
    if (activePath) release(activePath);
    activePath = "";
    src.value = "";
    status.value = "idle";
    error.value = "";
  }

  async function load(rawPath) {
    clear();

    const path = String(rawPath ?? "").trim();
    if (!path) return;

    activePath = path;
    status.value = "loading";

    try {
      const url = await acquire(path).promise;
      if (activePath !== path) return;
      src.value = url;
      status.value = "ready";
    } catch (err) {
      if (activePath !== path) return;
      error.value = err?.message || "素材加载失败";
      status.value = "error";
    }
  }

  watch(readSource, load, { immediate: true });
  onBeforeUnmount(clear);

  return {
    src,
    status,
    error,
    reload: () => load(readSource()),
  };
}

export default useMediaObjectUrl;
