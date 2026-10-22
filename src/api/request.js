import { buildApiUrl, getApiHeaders } from "@/config/api";
import { extractErrorMessage } from "@/api/errors";

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
    useAuth = false,  // 是否使用鉴权，即是否在请求头中带上 access token
    skipRefresh = false, // 是否跳过刷新 access token 的逻辑
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
      // 刷新也救不回来：会话已彻底失效，通知 App 强制登出（否则界面看似登录但什么都调不动）
      notifySessionLost();
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
    // 账号被封禁：除 /me/* 三条申诉接口外一切接口都 403 E_BANNED。
    // 广播一次，交给 App.vue 把界面切到申诉页（这里不直接依赖路由，避免循环引用）。
    if (error.code === "E_BANNED" && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("mistarg:banned", { detail: payload?.error?.detail ?? {} }),
      );
    }
    // 刷新后仍是 401：会话无法恢复，交给 App 统一登出并回到登录页
    if (response.status === 401 && useAuth) {
      notifySessionLost();
    }
    throw error;
  }

  return raw ? payload : payload;
}

// 会话彻底失效（刷新也救不回来）时广播，由 App.vue 统一登出并回到登录页。
function notifySessionLost() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mistarg:session-lost"));
}

export default request;

// 非 JSON 通道（素材 blob、可塑区组件 ESM）也要带同一份鉴权头：
// 这两类下发同样走取题门禁，只靠 Cookie 拿不到登录态（刷新令牌只挂在 /api/auth 路径上）。
function getAuthHeaders(extra = {}) {
  const headers = getApiHeaders(extra);
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// 带登录态的原始请求层：给「不是 JSON」的通道用（素材二进制、可塑区组件 ESM）。
//
// 这些接口同样走取题门禁，但响应体是 JS 代码或二进制，既没有 { ok, data } 信封，
// 也不能当文本读（blob 会被 text() 破坏），所以不能走 request()。
// 这里复用同一套令牌与刷新逻辑：401 时先刷新再重试一次，
// 避免 access token 过期后素材/组件直接失败、而普通接口却自动恢复。
// 返回原始 Response，由调用方决定 text() / blob()。
export async function fetchWithAuth(url, options = {}, { retried = false } = {}) {
  const { headers = {}, ...init } = options;
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { ...getAuthHeaders(), ...headers },
  });

  if (response.status !== 401 || retried) {
    return response;
  }

  try {
    await refreshAccessToken();
  } catch {
    // 刷新也救不回来：保持原有 401 响应，由调用方提示；同时通知会话失效
    notifySessionLost();
    return response;
  }

  return fetchWithAuth(url, options, { retried: true });
}
