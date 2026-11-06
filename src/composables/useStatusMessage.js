import { ref } from "vue";

// 操作结果提示（各页面共用）：文案 + 语义色。
// 统一走 set(tone, message) 写入，避免「文案与颜色分开赋值」后两边不同步。
// tone 取值：info（说明）、pending（进行中）、success（成功）、error（失败），与 StatusMessage.vue 对应。
export function useStatusMessage() {
  const message = ref("");
  const tone = ref("info");

  function set(nextTone, nextMessage) {
    tone.value = nextTone;
    message.value = String(nextMessage ?? "");
  }

  function clear() {
    set("info", "");
  }

  return { message, tone, set, clear };
}
