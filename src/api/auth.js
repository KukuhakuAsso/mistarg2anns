import request, { setAccessToken, clearAccessToken } from "@/api/request";

//接口具体功能和参数见api文档

export const authApi = {
  // 获取注册配置（用于注册页面初始化）
  getRegistrationConfig: () =>
    request("/auth/reg/config", {
      method: "GET",
      skipRefresh: true,
    }),

  // 用户登录
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

  // 用户注册
  register: (payload) =>
    request("/auth/register", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  // 检查用户名是否可用
  usernameAvailable: (username) =>
    request("/auth/username-available", {
      method: "POST",
      body: { username },
      skipRefresh: true,
    }),

  // 发送邮箱验证码
  sendVerificationCode: (payload) =>
    request("/auth/reg/start", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  // 验证邮箱验证码
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

  // 修改密码
  changePassword: (payload) =>
    request("/auth/password", {
      method: "POST",
      body: payload,
      useAuth: true,
    }),

  // 修改用户名
  changeUsername: (payload) =>
    request("/auth/username", {
      method: "POST",
      body: payload,
      useAuth: true,
    }),

  // 忘记密码
  forgotPassword: (payload) =>
    request("/auth/forgot", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  // 重置密码
  resetPassword: (payload) =>
    request("/auth/reset", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  // 刷新访问令牌
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

  // 初始化会话 (用于免密登录)
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

  // 注销当前会话
  logout: () =>
    request("/auth/logout", {
      method: "POST",
      useAuth: true,
      skipRefresh: true,
    }).finally(() => {
      clearAccessToken();
    }),

  // 注销所有会话
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
