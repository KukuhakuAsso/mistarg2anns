import { buildApiUrl, getApiHeaders } from "@/config/api";

// access token key JWT，2 小时。所有需要登录的接口用 Authorization: Bearer <token>
const ACCESS_TOKEN_KEY = "mistarg_access_token";

let refreshRequestPromise = null;

// 读取 localStorage；环境不可用（无 window / 隐私模式）时返回 null。
function readStorage(key) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

// 写入 localStorage；失败时静默忽略。
function writeStorage(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // localStorage may be unavailable in private browsing or restricted environments.
  }
}

// 删除 localStorage 中的键；失败时静默忽略。
function removeStorage(key) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // localStorage may be unavailable in private browsing or restricted environments.
  }
}

// 读取本地 access token；不存在时返回空字符串。
function getAccessToken() {
  return readStorage(ACCESS_TOKEN_KEY) || "";
}

// 保存 access token；传入空值时改为清除。
export function setAccessToken(token) {
  if (!token) {
    removeStorage(ACCESS_TOKEN_KEY);
    return;
  }

  writeStorage(ACCESS_TOKEN_KEY, token);
}

// 清除本地 access token。
export function clearAccessToken() {
  removeStorage(ACCESS_TOKEN_KEY);
}

// 把查询参数拼接到 URL 上；跳过 undefined / null / 空字符串，数组值按重复键展开。
function appendQueryString(url, params = {}) {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) {
    return url;
  }

  const query = new URLSearchParams();
  entries.forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, String(item)));
      return;
    }
    query.append(key, String(value));
  });

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${query.toString()}`;
}

// 从错误响应中提取可读文案：依次尝试 error.message、message、error，都没有时返回兜底文案。
function extractErrorMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  if (typeof payload.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message;
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  return "Request failed.";
}

// 读取响应体并尽力解析为 JSON；raw 为 true 时额外带上原始 Response 与解析结果。
async function readResponse(response, raw = false) {
  const text = await response.text();
  if (!text) {
    return raw ? { response, data: null } : null;
  }

  try {
    const json = JSON.parse(text);
    return raw ? { response, data: json } : json;
  } catch (error) {
    return raw ? { response, data: text } : text;
  }
}

// 用 cookie 刷新 access token 并写回本地；并发调用共享同一个请求，失败时清除本地 token 并抛出。
async function refreshAccessToken() {
  if (refreshRequestPromise) {
    return refreshRequestPromise;
  }

  refreshRequestPromise = (async () => {
    const response = await fetch(buildApiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: getApiHeaders(),
    });

    const payload = await readResponse(response);

    if (!response.ok) {
      clearAccessToken();
      throw new Error(extractErrorMessage(payload) || "Refresh token expired or invalid.");
    }

    const nextToken = payload?.data?.access_token || payload?.access_token || payload?.token;
    if (nextToken) {
      setAccessToken(nextToken);
    }

    return payload;
  })();

  try {
    return await refreshRequestPromise;
  } finally {
    refreshRequestPromise = null;
  }
}

// 统一请求入口：拼接 URL 与请求头后发起 fetch；需鉴权的请求遇到 401 会自动刷新 token 并重试一次，
// 非 2xx 时抛出带 status / payload / code 的错误。
export async function request(path, options = {}) {
  const {
    method = "GET",
    body,
    headers = {},
    params = {},
    useAuth = false,
    skipRefresh = false,
    raw = false,
    signal,
  } = options;
  const url = appendQueryString(buildApiUrl(path), params);
  const requestHeaders = {
    ...getApiHeaders(),
    ...headers,
  };

  if (useAuth) {
    const token = getAccessToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const fetchOptions = {
    method,
    credentials: "include",
    headers: requestHeaders,
    signal,
  };

  if (body !== undefined && body !== null) {
    fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  let response = await fetch(url, fetchOptions);
  
  if (
    response.status === 401 &&
    useAuth &&
    !skipRefresh &&
    !String(path).includes("/auth/refresh")
  ) {
    try {
      await refreshAccessToken();
      const retryHeaders = {
        ...requestHeaders,
        Authorization: `Bearer ${getAccessToken()}`,
      };

      response = await fetch(url, {
        ...fetchOptions,
        headers: retryHeaders,
      });
    } catch (error) {
      clearAccessToken();
      throw error;
    }
  }

  const payload = await readResponse(response, raw);

  if (!response.ok) {
    const message = extractErrorMessage(payload);
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    error.code = payload?.error?.code || payload?.code;
    throw error;
  }

  return raw ? payload : payload;
}

export default request;
