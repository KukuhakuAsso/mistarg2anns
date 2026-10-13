import { onScopeDispose, ref, watch } from "vue";
import { extractFieldMessages } from "@/api/errors";

// 名称查重（用户名 / 队名共用）：本地规则即时校验 + 防抖查唯一性 + 序号防竞态。
// 判定采用「正向确认制」：只有接口明确回 available / taken 才落状态，未知响应保持中性。
//
// 注意：writeBack 为 true 时，value 必须是可写 ref。
export function useNameAvailability({
  value,
  validate,
  check,
  normalize = (raw) => String(raw ?? "").trim(),
  enabled = () => true,
  unchanged,
  debounce = 600,
  writeBack = false,
  messages = {},
}) {
  const status = ref("idle");
  const message = ref("");

  let timer = null;
  // 请求代号：每次输入变化都递增，只有最新一次请求的结果生效。
  let generation = 0;
  // 已得出结论的名字：写回归一化值会再次触发 watch，用它避免重复查重。
  let settledName = "";

  function setStatus(next, text = "") {
    status.value = next;
    message.value = text;
  }

  function cancelPending() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    generation += 1;
  }

  // 清空状态并作废在途请求：切换模式、提交成功、提交失败落位前调用。
  function reset() {
    cancelPending();
    settledName = "";
    setStatus("idle");
  }

  watch(value, (raw) => {
    cancelPending();

    const name = normalize(raw);
    if (!enabled() || !name) {
      setStatus("idle");
      return;
    }

    const validation = validate(name);
    if (!validation.ok) {
      setStatus("invalid", validation.message);
      return;
    }

    const checkedName = validation.value ?? name;

    if (unchanged?.(checkedName)) {
      setStatus("unchanged", messages.unchanged ?? "");
      return;
    }

    if (checkedName === settledName) {
      return;
    }

    const requestId = generation;
    // 防抖等待期间就给出反馈，避免停留在上一次的旧结论上。
    setStatus("checking", messages.checking ?? "");

    timer = window.setTimeout(async () => {
      try {
        const response = await check(checkedName);
        if (requestId !== generation) {
          return;
        }

        const data = response?.data ?? {};

        // 后端返回的是归一化后的名字，与输入不同则回写输入框。
        if (writeBack && data.name && data.name !== value.value) {
          settledName = data.name;
          value.value = data.name;
        } else {
          settledName = checkedName;
        }

        const isAvailable =
          data.available === true || data.status === "available";
        const isTaken = data.available === false || data.status === "taken";

        if (isTaken) {
          setStatus("taken", messages.taken ?? "");
        } else if (isAvailable) {
          setStatus("available", messages.available ?? "");
        } else {
          // 未知状态不表态，避免把「没听说被占用」当成「可以使用」。
          setStatus("idle");
        }
      } catch (error) {
        if (requestId !== generation) {
          return;
        }

        // 400 时后端会在 detail.fields.<字段> 写明不合规的具体原因。
        const fieldMessage = extractFieldMessages(error)[0] || "";
        if (fieldMessage) {
          setStatus("invalid", fieldMessage);
          return;
        }

        // 未提供 error 文案时保持静默（不打扰用户，允许直接提交）。
        setStatus("idle", messages.error ?? "");
      }
    }, debounce);
  });

  onScopeDispose(cancelPending);

  return { status, message, reset, setStatus };
}
