// 后端错误体解析：统一把错误响应整理成一句可直接展示的文案。
//
// 后端错误体形如：
//   { ok: false, error: { code, message, detail: { fields: { email: "邮箱格式不正确", ... }, reason } } }
// 也可能被请求层包在 error.payload 上，或以扁平的 { code, detail } 形式出现，这里都兼容。

const DEFAULT_ERROR_MESSAGE = "Request failed.";

// 取第一个非空字符串（非字符串一律忽略）。
function firstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

// 取出错误体：请求失败抛出的 Error 会把响应体挂在 payload 上，此时以响应体为准。
export function resolveErrorPayload(source) {
  if (source?.payload && typeof source.payload === "object") {
    return source.payload;
  }
  return source && typeof source === "object" ? source : {};
}

// 取出字段级报错明细：detail.fields 形如 { email: "邮箱格式不正确", username: "用户名不能为空" }，
// 同一个响应里可能同时含多个字段的原因，这里按出现顺序全部取出并去重。
export function extractFieldMessages(source) {
  const payload = resolveErrorPayload(source);
  const detail = payload.error?.detail ?? payload.detail ?? {};
  const fields = detail?.fields;

  // 如果 fields 是字符串，直接返回该字符串作为唯一的错误信息。
  if (typeof fields === "string") {
    return firstNonEmpty(fields) ? [fields.trim()] : [];
  }
  // 如果 fields 不是对象，直接返回空数组。
  if (!fields || typeof fields !== "object") {
    return [];
  }
  // 遍历 fields 对象的值，取出所有非空的错误信息并去重。
  const messages = [];
  for (const value of Object.values(fields)) {
    const text = firstNonEmpty(value);
    if (text && !messages.includes(text)) {
      messages.push(text);
    }
  }

  return messages;
}

// 把错误整理成一句展示文案；source 可以是响应体，也可以是抛出的 Error。
export function extractErrorMessage(source, fallback = DEFAULT_ERROR_MESSAGE) {
  const payload = resolveErrorPayload(source);

  // 字段级原因优先：E_VALIDATION 的 error.message 通常只是笼统的「参数校验失败」，
  // 真正有用的原因在 detail.fields 里，多个字段的原因用分号连成一句。
  const fieldMessages = extractFieldMessages(payload);
  if (fieldMessages.length) {
    return fieldMessages.join("；");
  }

  const backendMessage = firstNonEmpty(
    payload.error?.message,
    payload.message,
    typeof payload.error === "string" ? payload.error : "",
    payload.error?.detail?.reason,
    payload.detail?.reason,
  );
  if (backendMessage) {
    return backendMessage;
  }

  // Error 自带的 message 可能只是请求层的通用兜底文案，此时优先用调用方给的文案。
  const ownMessage = firstNonEmpty(source?.message);
  if (ownMessage && ownMessage !== DEFAULT_ERROR_MESSAGE) {
    return ownMessage;
  }

  return firstNonEmpty(fallback, ownMessage) || DEFAULT_ERROR_MESSAGE;
}
