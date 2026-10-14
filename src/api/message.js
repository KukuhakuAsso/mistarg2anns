import request from "@/api/request";

// 站内信与官方公告接口：所有 /api/msg/* 均要求登录，统一 useAuth: true。
// 成功响应为 { ok: true, data, req_id }；失败为 { ok: false, error: { code, message, detail }, req_id }。
// 失败时 request 抛出的 Error 带 status / code / payload，调用方读取 error.payload.error.message。
export const messageApi = {
  // 会话列表：官方公告 + 自己的账号级会话 + 自己的队伍会话（GET /api/msg/threads）
  getThreads: () =>
    request("/msg/threads", {
      method: "GET",
      useAuth: true,
    }),

  // 增量拉取会话消息（GET /api/msg/thread/:id?since_id=&limit=）
  // 增量时把上次响应的 data.lastId 作为 sinceId 传入。
  getThreadMessages: (threadId, { sinceId = 0, limit = 50 } = {}) =>
    request(`/msg/thread/${threadId}`, {
      method: "GET",
      params: { since_id: sinceId, limit },
      useAuth: true,
    }),

  // 标记已读（POST /api/msg/thread/:id/read），lastReadId 通常取会话响应的 data.lastId
  markRead: (threadId, lastReadId) =>
    request(`/msg/thread/${threadId}/read`, {
      method: "POST",
      body: { last_read_id: lastReadId },
      useAuth: true,
    }),

  // 未读角标（GET /api/msg/summary），响应为 no-store，不得缓存
  getSummary: () =>
    request("/msg/summary", {
      method: "GET",
      useAuth: true,
    }),

  // 发送消息（POST /api/msg/send）；玩家可省略 threadId，由后端用自己队伍的会话
  send: ({ threadId, content, contentType = "text" } = {}) =>
    request("/msg/send", {
      method: "POST",
      body: {
        ...(threadId ? { thread_id: threadId } : {}),
        content,
        content_type: contentType,
      },
      useAuth: true,
    }),

  // 问题反馈（POST /api/msg/feedback）：任何登录用户可用，不要求有队伍
  feedback: ({ content, contentType = "text" } = {}) =>
    request("/msg/feedback", {
      method: "POST",
      body: { content, content_type: contentType },
      useAuth: true,
    }),

  // 人工求提示（POST /api/msg/hint）：无请求体，按队伍共享 tips 扣费
  requestHint: () =>
    request("/msg/hint", {
      method: "POST",
      body: {},
      useAuth: true,
    }),

  // 我的提示请求历史（GET /api/msg/hint-requests?cursor=&limit=），倒序游标分页
  getHintRequests: ({ cursor = 0, limit = 20 } = {}) =>
    request("/msg/hint-requests", {
      method: "GET",
      params: { cursor, limit },
      useAuth: true,
    }),
};

export default messageApi;
