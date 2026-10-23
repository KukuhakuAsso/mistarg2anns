// 后端接口的地址与请求头配置：API 基址、版本头、测试票据，以及正式 / 测试环境的切换。
import { ref } from "vue";

// 用户手动选择的 API 环境记在 localStorage 的这个键下。更改为测试/生产环境时，会更新此值。
const API_ENVIRONMENT_STORAGE_KEY = "mistarg2anns:api-environment";

// 构建期由 VITE_* 环境变量注入的配置；testTicket 为空表示未配置测试环境，此时不允许切到 test。
export const apiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/",
  basePath: import.meta.env.VITE_API_BASE_PATH || "/api",
  apiVersion: import.meta.env.VITE_API_VERSION || "mistarg.2026.v1",
  devTicket: import.meta.env.VITE_DEV_TICKET || "",
  testTicket: import.meta.env.VITE_X_MISTARG_TEST_TICKET || "",
};

// 解析当前应使用的 API 环境：localStorage 里的用户选择优先，其次是 VITE_API_ENVIRONMENT；
// 两条路径都要求存在测试票据，否则一律落在 production。
function readApiEnvironment() {
  const configuredEnvironment =
    import.meta.env.VITE_API_ENVIRONMENT === "test" ? "test" : "production";

  if (typeof window === "undefined") {
    return configuredEnvironment;
  }

  try {
    const savedEnvironment = window.localStorage.getItem(
      API_ENVIRONMENT_STORAGE_KEY,
    );
    if (
      savedEnvironment === "test" &&
      apiConfig.testTicket
    ) {
      return "test";
    }
    if (savedEnvironment === "production") {
      return "production";
    }
  } catch (error) {
    console.warn("[mistarg2anns] 读取 API 环境设置失败", error);
  }

  return configuredEnvironment === "test" && apiConfig.testTicket
    ? "test"
    : "production";
}

// 当前生效的 API 环境（响应式，供界面显示与切换）。
export const apiEnvironment = ref(readApiEnvironment());

// 切换 API 环境并持久化到 localStorage；环境名非法或缺少测试票据时抛错。
export function setApiEnvironment(environment) {
  if (!["test", "production"].includes(environment)) {
    throw new Error("API 环境仅支持测试环境或正式环境。");
  }

  if (environment === "test" && !apiConfig.testTicket) {
    throw new Error("未配置测试票据，无法切换到测试环境。");
  }

  apiEnvironment.value = environment;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(API_ENVIRONMENT_STORAGE_KEY, environment);
    } catch (error) {
      console.warn("[mistarg2anns] 保存 API 环境设置失败", error);
    }
  }
}

// 拼接完整请求地址：baseUrl + basePath + path（baseUrl 为绝对 URL 时同样适用）。
export function buildApiUrl(path) {
  const normalized = String(path ?? "/").trim();
  const safePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const base = apiConfig.baseUrl || "";
  const apiPrefix = apiConfig.basePath || "/api";
  // 健康检查挂在 /api-mist 下而非 /api，需要单独拼。
  if (path === "/api-mist/healthz") {
    return `${base.replace(/\/+$/, "")}/api-mist/healthz`;
  }
  return `${base.replace(/\/+$/, "")}${apiPrefix}${safePath}`;
}

// 当前 API 部署的源：baseUrl 可能是空、"/" 或绝对地址（如 https://api.example.com/）。
function apiOrigin() {
  const fallback =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  try {
    return new URL(apiConfig.baseUrl || "/", fallback).origin;
  } catch {
    return fallback;
  }
}

// 判断一个地址是否指向本 API 部署（同源 + 落在 basePath 之下）。
//
// 这是「要不要带用户凭证」的唯一判据：素材与组件的 URL 都由服务端下发，
// 前端不能默认它们一定是自家的（见下方 resolveServerUrl 的外链分支）。
// 相对路径按当前页面解析，所以 `/api-mist/puzzle/media/18` 会被判为可信，
// 而同源但不在 API 前缀下的路径判为不可信（宁可拿 401，也别把令牌发出去）。
export function isApiUrl(url) {
  const raw = String(url ?? "").trim();
  // blob:/data: 不产生网络请求，谈不上携带凭证
  if (!raw || /^(?:blob|data):/i.test(raw)) return false;

  const base =
    typeof window === "undefined" ? "http://localhost/" : window.location.href;
  let parsed;
  try {
    parsed = new URL(raw, base);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.origin !== apiOrigin()) return false;

  const prefix = (apiConfig.basePath || "/api").replace(/\/+$/, "");
  return parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`);
}

// api-12 约定：cover / attachments / malleable.asset 的 url 由后端拼成 `/api/…`。
// 开发期看到绝对地址就说明契约被破坏了（CDN 直链迁移、脏数据等），
// 这里把偏离显性化；生产环境由 fetchWithAuth 的信任边界兜底（外链不带凭证）。
function warnIfExternalAssetUrl(raw) {
  if (!import.meta.env.DEV) return;
  if (!/^(?:https?:)?\/\//i.test(raw)) return;
  console.warn(
    `[mistarg2anns] 素材 / 组件地址不是本站路径：${raw}\n` +
      "api-12 约定这些字段由后端拼成 /api/…；绝对地址不会携带访问令牌与测试票据。",
  );
}

// 后端返回的素材 / 组件地址都是后端自身的绝对路径（`/api/puzzle/media/18`）。
// 开发与生产部署的 API 前缀可能是 `/api-mist` 等，直接用会打到静态站点上 404，
// 所以统一在这里把 `/api` 前缀换成当前生效的 baseUrl + basePath；外链与 blob/data 原样返回
// （外链不重写，但也不会被带上凭证 —— 见 isApiUrl）。
export function resolveServerUrl(path) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  if (/^(?:https?:)?\/\//i.test(raw) || /^(?:blob|data):/i.test(raw)) {
    warnIfExternalAssetUrl(raw);
    return raw;
  }
  if (raw.startsWith("/api/")) {
    const base = (apiConfig.baseUrl || "").replace(/\/+$/, "");
    const prefix = apiConfig.basePath || "/api";
    return `${base}${prefix}${raw.slice("/api".length)}`;
  }
  return raw;
}

// 生成通用请求头；处于测试环境且配置了测试票据时，额外带上 X-Mistarg-Test-Ticket。
export function getApiHeaders(extra = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-Version": apiConfig.apiVersion,
    ...extra,
  };

  if (apiEnvironment.value === "test" && apiConfig.testTicket) {
    headers["X-Mistarg-Test-Ticket"] = apiConfig.testTicket;
  }

  return headers;
}
