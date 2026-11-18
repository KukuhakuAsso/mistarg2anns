// 组件题状态桥的宿主生命周期：创建、随题目切换重建、运行时同步、卸载销毁。
//
// 协议与快照维护在 utils/pzBridge.js；这里只把它接到题目视图上，
// 并保证切题 / 换组件 / 登出后旧桥拿到迟到响应也不会写回本页面。
import { onBeforeUnmount, shallowRef, toValue, watch } from "vue";
import { puzzleApi } from "@/api/puzzle";
import { createPzBridge } from "@/utils/pzBridge";

export function usePzBridge(options) {
  const bridge = shallowRef(null);
  let bridgeSignature = null;

  // 题目、模式、组件 tag 任一变化都要换桥：旧桥的迟到响应不能落到新组件上
  function signature() {
    return [
      String(toValue(options.puzzleKey) ?? ""),
      String(toValue(options.mode) ?? ""),
      String(toValue(options.tag) ?? ""),
    ].join("\u0000");
  }

  function rebuild() {
    const next = signature();
    if (bridge.value && next === bridgeSignature) return;

    bridge.value?.dispose();
    bridgeSignature = next;
    bridge.value = createPzBridge({
      puzzleKey: String(toValue(options.puzzleKey) ?? ""),
      mode: String(toValue(options.mode) ?? ""),
      runtime: toValue(options.runtime),
      view: toValue(options.view),
      callRpc: puzzleApi.rpc,
      callState: puzzleApi.getState,
    });
  }

  // 题目 / 模式 / 组件版本变化都要换桥：快照与幂等记录都属于「本队本题 + 这个组件」
  watch(
    () => [
      toValue(options.puzzleKey),
      toValue(options.mode),
      toValue(options.tag),
    ],
    rebuild,
    { immediate: true },
  );
  // 视图重新拉回（点击重试、解题后刷新、买提示）时同步 runtime
  watch(
    () => toValue(options.runtime),
    (runtime) => bridge.value?.hydrateRuntime(runtime),
  );
  watch(
    () => toValue(options.view),
    (view) => bridge.value?.setView(view),
  );

  onBeforeUnmount(() => {
    bridge.value?.dispose();
    bridge.value = null;
  });

  return { bridge };
}

export default usePzBridge;
