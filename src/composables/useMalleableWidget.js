// 可塑区组件的加载器：fetch → sha384 校验 → Blob → import() → customElements.whenDefined。
//
// 关键约束（api-12）：
//   * 顺序不可换，校验不通过必须中止，绝不执行未通过校验的代码；
//   * 组件包内联了自己的 Vue 运行时，跨边界只传纯数据（props），不传宿主的响应式对象；
//   * 同一 tag 已注册就不再下载；props 变化不需要重新下载，rev 变化只需刷新数据。
//
// 实测服务端有两种下发形态：直接 200 + text/javascript，或 302 到 CDN 鉴权地址。
// fetch 默认跟随跳转，两种形态都会落到同一段「取文本」逻辑上。
import { ref } from "vue";
import { fetchWithAuth } from "@/api/request";
import { extractErrorMessage } from "@/api/errors";
import { resolveServerUrl } from "@/config/api";
import { verifySha384 } from "@/utils/integrity";

// 已注册的组件 tag（进程级，跨页面复用）
const registered = new Set();
// 正在下载中的 tag → Promise，避免同一组件并发下载多份
const pending = new Map();
// 等待组件注册完成，超时则拒绝。
function waitForDefinition(tag, timeoutMs = 10000) {
  if (typeof customElements === "undefined") {
    return Promise.resolve();
  }
  return Promise.race([
    customElements.whenDefined(tag),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`组件未注册 <${tag}>`)), timeoutMs);
    }),
  ]);
}

// 下载并加载组件，返回注册的 tag。
async function loadAsset(asset) {
  const tag = asset?.tag;
  const url = asset?.url;
  if (!tag || !url) throw new Error("组件描述符不完整");

  if (registered.has(tag)) return tag;
  if (pending.has(tag)) return pending.get(tag);
  // 开始下载组件，避免重复请求。
  const task = (async () => {
    const response = await fetchWithAuth(resolveServerUrl(url), {
      headers: { Accept: "text/javascript" },
    });
    if (!response.ok) {
      // 失败时是标准 JSON 错误体；429 额外带上等待秒数，其余直接用后端文案
      const payload = await response.json().catch(() => null);
      const waitSec = Number(payload?.error?.detail?.retry_after_sec) || 0;
      throw new Error(
        response.status === 429 && waitSec > 0
          ? `请求过于频繁，请 ${waitSec} 秒后再试`
          : extractErrorMessage(payload, `组件加载失败（${response.status}）`),
      );
    }

    const code = await response.text();
    if (asset.integrity && !(await verifySha384(code, asset.integrity))) {
      throw new Error("组件完整性校验未通过，已阻止执行");
    }
    // 将组件代码转为 Blob URL 并动态 import，确保只执行通过校验的代码。
    const blobUrl = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    try {
      await import(/* @vite-ignore */ blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    await waitForDefinition(tag);
    registered.add(tag);
    return tag;
  })();

  pending.set(tag, task);
  try {
    return await task;
  } finally {
    pending.delete(tag);
  }
}

export function useMalleableWidget() {
  const status = ref("idle"); // idle | loading | ready | error
  const error = ref("");
  const tag = ref("");
  let token = 0;

  async function ensure(asset) {
    // 没有 asset（组件已停用等异常）：交给调用方显示区内 fallback
    if (!asset?.tag || !asset?.url) {
      status.value = "error";
      error.value = "该题暂无可用的交互组件";
      return;
    }
    if (tag.value === asset.tag && status.value === "ready") return;

    const current = ++token;
    status.value = "loading";
    error.value = "";

    try {
      const resolved = await loadAsset(asset);
      if (current !== token) return;
      tag.value = resolved;
      status.value = "ready";
    } catch (err) {
      if (current !== token) return;
      tag.value = "";
      error.value = err?.message || "组件加载失败";
      status.value = "error";
    }
  }

  // 组件卸载后丢弃迟到的加载结果
  function cancel() {
    token += 1;
  }

  return { status, error, tag, ensure, cancel };
}

export default useMalleableWidget;
