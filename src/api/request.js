import { buildApiUrl, getApiHeaders, isApiUrl } from "@/config/api";
import { extractErrorMessage } from "@/api/errors";

// access token key JWT，2 小时。所有需要登录的接口用 Authorization: Bearer <token>
const ACCESS_TOKEN_KEY = "mistarg_access_token";

let refreshRequestPromise = null;

// 会话代次：登录、注册、改名 / 改密换令牌、登出、强制登出都会 +1。
//
// 刷新令牌是异步的（一次带 Cookie 的网络往返）。若 A 的刷新还没回来，用户已经登出、
// B 又登录进来，那么这次响应属于**旧会话**：既不能拿它的 access_token 覆盖 B 的令牌，
// 也不能拿它重试原请求（否则之后所有请求都会以 A 的身份发出）。
// 所以刷新在发起时记下代次，写回前比对，不一致就整份丢弃。
let sessionGeneration = 0;

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
// 这是「身份变更」入口（登录 / 注册 / 改名 / 改密拿到新令牌），必须推进会话代次：
// 还在飞的旧会话刷新从此作废。刷新自身的写回不走这里，见 applyRefreshedToken()。
export function setAccessToken(token) {
  sessionGeneration += 1;

  if (!token) {
    removeStorage(ACCESS_TOKEN_KEY);
    return;
  }

  writeStorage(ACCESS_TOKEN_KEY, token);
}

// 清除本地 access token（登出 / 强制登出 / 令牌彻底失效）。
// 同样推进代次：在飞的刷新回来后会被判定为旧会话，不会再写回令牌。
export function clearAccessToken() {
  sessionGeneration += 1;
  removeStorage(ACCESS_TOKEN_KEY);
}

// 刷新专用写回：只有代次没变（仍是同一个会话）时才落盘，自己不推进代次。
// 返回是否写回成功。
function applyRefreshedToken(token, generation) {
  if (!token || generation !== sessionGeneration) return false;
  writeStorage(ACCESS_TOKEN_KEY, token);
  return true;
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

// 用 cookie 刷新 access token 并写回本地；并发调用共享同一个请求。
//
// generation 是发起方的会话代次。返回 { ok, stale, error? }：
//   · ok     —— 刷新成功且令牌已写回（仍是同一个会话）
//   · stale  —— 期间登出 / 换了账号，这次刷新属于旧会话：不写回、不清令牌，调用方应放弃重试
//   · error  —— 真的过期了：本地令牌已清除，调用方负责通知会话失效
async function refreshAccessToken(generation = sessionGeneration) {
  if (refreshRequestPromise) {
    const shared = await refreshRequestPromise;
    // 共享的那次刷新属于另一个会话：它的结果不能当成自己的
    if (shared.generation !== generation) return { ok: false, stale: true, generation };
    return shared;
  }

  const task = (async () => {
    let response;
    try {
      response = await fetch(buildApiUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
        headers: getApiHeaders(),
      });
    } catch (error) {
      // 网络层失败（离线 / 被中断）：不代表会话失效，但这次刷新用不了
      return {
        ok: false,
        stale: generation !== sessionGeneration,
        generation,
        error,
        network: true,
      };
    }

    const payload = await readResponse(response);

    // 响应回来时已经换过会话：不管成功还是失败都不能动当前会话的令牌
    if (generation !== sessionGeneration) {
      return { ok: false, stale: true, generation };
    }

    if (!response.ok) {
      clearAccessToken();
      return {
        ok: false,
        stale: false,
        generation,
        error: new Error(extractErrorMessage(payload) || "Refresh token expired or invalid."),
      };
    }

    const nextToken = payload?.data?.access_token || payload?.access_token || payload?.token;
    // 写回前再比一次代次（readResponse 也是异步的）
    applyRefreshedToken(nextToken, generation);
    return { ok: true, stale: generation !== sessionGeneration, generation, payload };
  })();

  refreshRequestPromise = task;

  try {
    return await task;
  } finally {
    if (refreshRequestPromise === task) refreshRequestPromise = null;
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

  // 发起前记下会话代次：这次请求属于哪个会话，由「发出时」决定，而不是响应回来时。
  // 否则 A 会话发出的请求在 B 登录之后才 401，会被当成 B 的请求、用 B 的凭证重放一次，
  // A 的 method/body 就落到了 B 的账号上。
  const generation = sessionGeneration;

  let response = await fetch(url, fetchOptions);
  
  if (
    response.status === 401 &&
    useAuth &&
    !skipRefresh &&
    !String(path).includes("/auth/refresh")
  ) {
    // 旧会话的请求：既不能拿新会话刷新出来的令牌重试（会用新身份重放旧请求），
    // 也不能继续往下走到 notifySessionLost —— 那会把刚登录的新会话踢下线。
    if (generation !== sessionGeneration) {
      throw await responseError(response);
    }

    const refreshed = await refreshAccessToken(generation);

    if (refreshed.stale) {
      // 刷新期间登出或换了账号：同样只把这个 401 抛给调用方，不重试、不广播会话失效。
      throw await responseError(response);
    } else if (refreshed.ok) {
      // 重试必须重新读一次令牌：刷新刚写回来的就是它
      response = await fetch(url, {
        ...fetchOptions,
        headers: { ...requestHeaders, ...getAuthHeaders() },
      });
    } else {
      // 刷新确实失败：网络层失败不代表会话失效，只有后端明确拒绝才强制登出
      if (!refreshed.network) {
        notifySessionLost();
      }
      throw refreshed.error;
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

// 把一次失败的响应收成错误对象（与下面非 2xx 的出口同形，但不广播会话失效）。
// 用于「旧会话的 401」：当前会话本身是好的，不能因为上一个会话的请求把新会话踢下线。
async function responseError(response) {
  const payload = await readResponse(response);
  const error = new Error(extractErrorMessage(payload));
  error.status = response.status;
  error.payload = payload;
  error.code = payload?.error?.code || payload?.code;
  return error;
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
//
// 信任边界：只对指向本 API 部署的地址带凭证。素材 / 组件的 url 来自服务端下发的
// 描述符，resolveServerUrl() 对绝对地址是原样透传的 —— 一旦后端改了约定（CDN 直链、
// 脏数据、被篡改的记录），无条件加 Authorization 就会把访问令牌与测试票据送给第三方。
//
// 已知未覆盖的情况（PR #101 review，2026-11-10 决定不修）：本函数只校验**初始** URL，
// 而 fetch 默认跟随重定向；若后端把某个素材 / 组件端点改成 302 到 CDN，浏览器会剥掉
// Authorization，但**不会**剥掉 X-Mistarg-Test-Ticket。生产构建没有配置测试票据
// （.env.production 无 VITE_X_MISTARG_TEST_TICKET，getApiHeaders 不会加这个头），
// 所以泄露面仅限 dev / test 构建；玩家侧 media / asset 两个端点按 api-12 是 200 直出，
// 目前不会发生重定向。若将来后端改成 302，需要改为后端同源直传或在此处做 manual 探测。
export async function fetchWithAuth(url, options = {}, { retried = false } = {}) {
  const { headers = {}, ...init } = options;
  const trusted = isApiUrl(url);

  // 与 request() 同一套口径：代次要在**发出前**记下。
  // 否则 A 会话发出的素材请求在 B 登录后才 401，会被当成 B 的请求拿 B 的令牌重取。
  const generation = sessionGeneration;

  const response = await fetch(url, {
    ...init,
    // 外部地址连 Cookie 也不带：那里的会话与本应用的登录态无关
    credentials: trusted ? "include" : "omit",
    headers: trusted ? { ...getAuthHeaders(), ...headers } : { ...headers },
  });

  // 外部地址的 401 说明不了本站会话的状态：不刷新令牌、也不触发登出
  if (!trusted || response.status !== 401 || retried) {
    return response;
  }

  // 旧会话的 401：同样说明不了当前会话，原样返回给调用方
  if (generation !== sessionGeneration) {
    return response;
  }

  const refreshed = await refreshAccessToken(generation);

  // 刷新期间登出 / 换了账号：同样原样返回，不重试、不动新会话的令牌
  if (refreshed.stale) {
    return response;
  }

  if (!refreshed.ok) {
    // 刷新也救不回来：保持原有 401 响应，由调用方提示；
    // 只有后端明确拒绝（而不是网络层失败）才通知会话失效
    if (!refreshed.network) {
      notifySessionLost();
    }
    return response;
  }

  return fetchWithAuth(url, options, { retried: true });
}
