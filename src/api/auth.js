import request, { setAccessToken, clearAccessToken } from "@/api/request";
import { getRegistrationHeaders } from "@/config/api";

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
      const token =
        result?.data?.access_token || result?.access_token || result?.token;
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
      headers: getRegistrationHeaders(),
      skipRefresh: true,
    }),

  verifyVerificationCode: (payload) =>
    request("/auth/reg/verify", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }).then((result) => {
      const token =
        result?.data?.access_token || result?.access_token || result?.token;
      if (token) {
        setAccessToken(token);
      }
      return result;
    }),

  changePassword: (payload) =>
    request("/auth/password", {
      method: "POST",
      body: payload,
      useAuth: true,
    }),

  changeUsername: (payload) =>
    request("/auth/username", {
      method: "POST",
      body: payload,
      useAuth: true,
    }),

  forgotPassword: (payload) =>
    request("/auth/forgot", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  resetPassword: (payload) =>
    request("/auth/reset", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  refresh: () =>
    request("/auth/refresh", {
      method: "POST",
      skipRefresh: true,
    }).then((result) => {
      const token =
        result?.data?.access_token || result?.access_token || result?.token;
      if (token) {
        setAccessToken(token);
      }
      return result;
    }),

  bootstrapSession: async () => {
    try {
      const result = await authApi.refresh();
      const payload = result?.data ?? result ?? {};
      const account = payload.account ?? payload.user ?? null;
      const token =
        payload?.access_token ||
        payload?.data?.access_token ||
        payload?.token ||
        "";

      if (token) {
        setAccessToken(token);
      }

      return {
        ok: true,
        account,
        accessToken: token,
        expiresIn: Number(payload.expires_in ?? payload?.data?.expires_in ?? 0),
      };
    } catch (error) {
      clearAccessToken();
      return {
        ok: false,
        account: null,
        accessToken: "",
        expiresIn: 0,
        error,
      };
    }
  },

  logout: () =>
    request("/auth/logout", {
      method: "POST",
      useAuth: true,
      skipRefresh: true,
    }).finally(() => {
      clearAccessToken();
    }),

  logoutAll: () =>
    request("/auth/logout-all", {
      method: "POST",
      useAuth: true,
      skipRefresh: true,
    }).finally(() => {
      clearAccessToken();
    }),
};

export default authApi;
