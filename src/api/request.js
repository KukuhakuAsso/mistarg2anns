import { apiConfig, buildApiUrl, getApiHeaders } from "@/config/api";

const ACCESS_TOKEN_KEY = "mistarg_access_token";
let refreshRequestPromise = null;

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

export function getAccessToken() {
  return readStorage(ACCESS_TOKEN_KEY) || "";
}

export function setAccessToken(token) {
  if (!token) {
    removeStorage(ACCESS_TOKEN_KEY);
    return;
  }

  writeStorage(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken() {
  removeStorage(ACCESS_TOKEN_KEY);
}

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

export async function refreshAccessToken() {
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
  console.log("Request URL with query string:", url);
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
