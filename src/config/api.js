export const apiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/",
  basePath: import.meta.env.VITE_API_BASE_PATH || "/api",
  apiVersion: import.meta.env.VITE_API_VERSION || "mistarg.2026.v1",
  devTicket: import.meta.env.VITE_DEV_TICKET || "",
  "X-Mistarg-Test-Ticket": import.meta.env.VITE_X_MISTARG_TEST_TICKET || "",
};

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
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-Version": apiConfig.apiVersion,
    ...extra,
  };
}

export function getRegistrationHeaders() {
  return apiConfig["X-Mistarg-Test-Ticket"]
    ? { "X-Mistarg-Test-Ticket": apiConfig["X-Mistarg-Test-Ticket"] }
    : {};
}
