import { ref } from "vue";

const API_ENVIRONMENT_STORAGE_KEY = "mistarg2anns:api-environment";

export const apiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/",
  basePath: import.meta.env.VITE_API_BASE_PATH || "/api",
  apiVersion: import.meta.env.VITE_API_VERSION || "mistarg.2026.v1",
  devTicket: import.meta.env.VITE_DEV_TICKET || "",
  testTicket: import.meta.env.VITE_X_MISTARG_TEST_TICKET || "",
};

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

export const apiEnvironment = ref(readApiEnvironment());

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

export function buildApiUrl(path) {
  const normalized = String(path ?? "/").trim();
  const safePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const base = apiConfig.baseUrl || "";
  const apiPrefix = apiConfig.basePath || "/api";
  if (path === "/api-mist/healthz") {
    console.log(
      "Building health check URL",
      `${base.replace(/\/+$/, "")}/api-mist/healthz`,
    );
    return `${base.replace(/\/+$/, "")}/api-mist/healthz`;
  }
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/+$/, "")}${apiPrefix}${safePath}`;
  }

  return `${base.replace(/\/+$/, "")}${apiPrefix}${safePath}`;
}

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
