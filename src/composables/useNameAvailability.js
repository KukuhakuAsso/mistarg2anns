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
  // 已得出结论的名字 + 当时的结论。
  // 只记名字是不够的：用户退格回到这个名字时，如果只有名字命中就直接 return，
  // 状态会停留在上一次的「检查中」（退格前正在查别的名字）或错误提示上。
  // 所以把结论一起缓存，命中时原样恢复。
  let settled = { name: "", status: "idle", message: "" };

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
    settled = { name: "", status: "idle", message: "" };
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

    // 回到已经查过、且已有结论的名字：恢复当时的结论。
    // 这里不能直接 return —— 那样会把「检查中」或上一条名字的错误提示留在界面上。
    if (checkedName === settled.name) {
      setStatus(settled.status || "idle", settled.message);
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

        const isAvailable =
          data.available === true || data.status === "available";
        const isTaken = data.available === false || data.status === "taken";

        // 结论先算好，再决定写回 —— 写回会同步改 value、并在下一 tick 再次触发 watch，
        // 那次触发会命中 settled，所以必须在这之前把结论存好。
        const next = isTaken
          ? { status: "taken", message: messages.taken ?? "" }
          : isAvailable
            ? { status: "available", message: messages.available ?? "" }
            : // 未知状态不表态，避免把「没听说被占用」当成「可以使用」
              { status: "idle", message: "" };

        // 后端可能返回归一化后的名字（如大小写、全角转换）：以它为准
        const settledName = writeBack && data.name ? data.name : checkedName;
        settled = { name: settledName, ...next };

        // 写回到输入框：与后端归一化结果不同才写，避免无意义的 watch
        if (writeBack && data.name && data.name !== value.value) {
          value.value = data.name;
        }

        setStatus(next.status, next.message);
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
