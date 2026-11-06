// Markdown 正文里的受保护图片（`![x](/api/puzzle/media/18)`）。
//
// 渲染器（miniMarkdown）只输出占位：<img data-media-path="/api/puzzle/media/18" ...>，
// 没有 src —— 原生 <img> 带不上 Authorization 头，也绕过了 resolveServerUrl() 的前缀重写。
// 这里在 DOM 更新之后统一用带鉴权的请求取回二进制，换成 blob URL 回填 src，
// 并在正文变化 / 组件卸载时释放引用，避免泄漏与串图（例如切题后旧图仍挂着上一个会话的 blob）。
import { onBeforeUnmount, watch } from "vue";
import {
  acquireMediaRecord,
  releaseMediaRecord,
} from "@/composables/useMediaObjectUrl";

// 只有渲染器打上标记的节点才会被接管
const MEDIA_SELECTOR = "img[data-media-path]";

// containerRef：v-html 承载元素的 ref
// htmlRef：渲染出来的 HTML 字符串（变化即需要重新回填）
export function useMarkdownMedia(containerRef, htmlRef) {
  // 本组件持有的素材记录（不是路径）：同一条素材在正文里出现多次就持有多个引用。
  // 必须持记录而不是路径——失败后别人重试会建新记录，按路径释放会减到别人的计数。
  let records = [];
  // 内容代号：切题 / 卸载后，迟到的响应不能再往已被替换的节点上写
  let generation = 0;

  function releaseAll() {
    for (const record of records) releaseMediaRecord(record);
    records = [];
  }

  // 逐个节点取图并回填；失败不抛错，只把状态标成 error 让 alt 文本接管占位
  function loadNode(node, gen) {
    const path = String(node.getAttribute("data-media-path") || "").trim();
    if (!path) return;

    const record = acquireMediaRecord(path);
    records.push(record);

    record.promise.then(
      (url) => {
        if (gen !== generation) return;
        node.setAttribute("data-media-state", "ready");
        node.setAttribute("src", url);
      },
      (error) => {
        if (gen !== generation) return;
        node.setAttribute("data-media-state", "error");
        node.setAttribute("title", error?.message || "图片加载失败");
      },
    );
  }

  function hydrate() {
    generation += 1;
    // 上一轮渲染出来的节点已经被 v-html 替换掉，它们持有的 blob 引用必须还回去
    releaseAll();

    const root = containerRef.value;
    if (!root) return;

    const gen = generation;
    for (const node of root.querySelectorAll(MEDIA_SELECTOR)) {
      loadNode(node, gen);
    }
  }

  // flush: "post" —— 等 v-html 把新内容写进 DOM 之后再查询节点；
  // 同时监听容器本身，覆盖 v-if 重新创建元素（同一份 HTML 也会重建 DOM）的情况。
  watch([containerRef, htmlRef], hydrate, { flush: "post", immediate: true });

  onBeforeUnmount(() => {
    generation += 1;
    releaseAll();
  });

  return { hydrate };
}

export default useMarkdownMedia;
