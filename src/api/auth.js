import request, { setAccessToken, clearAccessToken } from "@/api/request";

export const authApi = {
  getRegistrationConfig: () =>
    request("/auth/reg/config", {
      method: "GET",
      skipRefresh: true,
    }),

  login: (payload) =>
    request("/auth/login", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }).then((result) => {
      const token = result?.data?.access_token || result?.access_token || result?.token;
      if (token) {
        setAccessToken(token);
      }
      return result;
    }),

  register: (payload) =>
    request("/auth/register", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  usernameAvailable: (username) =>
    request("/auth/username-available", {
      method: "POST",
      body: { username },
      skipRefresh: true,
    }),

  sendVerificationCode: (payload) =>
    request("/auth/reg/start", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  verifyVerificationCode: (payload) =>
    request("/auth/reg/verify", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }).then((result) => {
      const token = result?.data?.access_token || result?.access_token || result?.token;
      if (token) {
        setAccessToken(token);
      }
      return result;
    }),

  refresh: () =>
    request("/auth/refresh", {
      method: "POST",
      skipRefresh: true,
    }).then((result) => {
      const token = result?.data?.access_token || result?.access_token || result?.token;
      if (token) {
        setAccessToken(token);
      }
      return result;
    }),

  logout: () =>
    request("/auth/logout", {
      method: "POST",
      useAuth: true,
      skipRefresh: true,
    }).finally(() => {
      clearAccessToken();
    }),
};

export default authApi;
