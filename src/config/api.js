// 后端接口的地址与请求头配置：API 基址、版本头、测试票据，以及正式 / 测试环境的切换。
import { ref } from "vue";

// 用户手动选择的 API 环境记在 localStorage 的这个键下。更改为测试/生产环境时，会更新此值。
const API_ENVIRONMENT_STORAGE_KEY = "mistarg2anns:api-environment";

// 构建期由 VITE_* 环境变量注入的配置；testTicket 为空表示未配置测试环境，此时不允许切到 test。
export const apiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/",
  basePath: import.meta.env.VITE_API_BASE_PATH || "/api",
  // 主、次版本必须与服务端一致（修订号差异 ≤5），否则全部业务接口 426 E_VERSION。
  // 不设置兜底值，必须由 VITE_API_VERSION 提供。
  apiVersion: import.meta.env.VITE_API_VERSION,
  devTicket: import.meta.env.VITE_DEV_TICKET || "",
  testTicket: import.meta.env.VITE_X_MISTARG_TEST_TICKET || "",
};

// 解析当前应使用的 API 环境：localStorage 里的用户选择优先，其次是 VITE_API_ENVIRONMENT；
// 两条路径都要求存在测试票据，否则一律落在 production。
function readApiEnvironment() {
  const configuredEnvironment =
    import.meta.env.VITE_API_ENVIRONMENT === "test" ? "test" : "production";

  try {
    const savedEnvironment = window.localStorage.getItem(
      API_ENVIRONMENT_STORAGE_KEY,
    );
    if (savedEnvironment === "test" && apiConfig.testTicket) {
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
  try {
    window.localStorage.setItem(API_ENVIRONMENT_STORAGE_KEY, environment);
  } catch (error) {
    console.warn("[mistarg2anns] 保存 API 环境设置失败", error);
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

// 当前 API 部署的源：baseUrl 可能是空、"/"（开发代理 / nginx 反代，同源），
// 也可能是绝对地址（GitHub Pages 预览站这类没有后端的部署，跨源）。
function apiOrigin() {
  const fallback = window.location.origin;
  try {
    return new URL(apiConfig.baseUrl || "/", fallback).origin;
  } catch {
    return fallback;
  }
}

// 判断一个地址是否指向本 API 部署（同源 + 落在 basePath 之下）。
export function isApiUrl(url) {
  const raw = String(url ?? "").trim();
  // blob:/data: 不产生网络请求，谈不上携带凭证
  if (!raw || /^(?:blob|data):/i.test(raw)) return false;

  const base = window.location.href;
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

// 约定：cover / attachments / malleable.asset 的 url 由后端拼成 `/api/…`。
// 绝对地址不带访问令牌与测试票据。
function warnIfExternalAssetUrl(raw) {
  if (!import.meta.env.DEV) return;
  if (!/^(?:https?:)?\/\//i.test(raw)) return;
  console.warn(
    `[mistarg2anns] 素材 / 组件地址不是本站路径：${raw}\n` +
      "约定这些字段由后端拼成 /api/…；绝对地址不会携带访问令牌与测试票据。",
  );
}

// 重写后端发来的链接
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
