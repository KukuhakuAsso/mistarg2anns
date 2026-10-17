import request from "@/api/request";

// 站内信与官方公告接口：所有 /api/msg/* 均要求登录，统一 useAuth: true。
// 成功响应为 { ok: true, data, req_id }；失败为 { ok: false, error: { code, message, detail }, req_id }。
// 失败时 request 抛出的 Error 带 status / code / payload，调用方读取 error.payload.error.message。
export const messageApi = {
  // 邮件列表（GET /api/msg/mails）：每条发信一行，倒序分页；
  // sinceId > 0 时切换为「取更新」（按 id 正序，轮询用），此时忽略 cursor。
  getMails: ({
    cursor = 0,
    sinceId = 0,
    limit = 20,
    channel,
    onlyUnread,
  } = {}) =>
    request("/msg/mails", {
      method: "GET",
      params: {
        cursor,
        since_id: sinceId,
        limit,
        ...(channel ? { channel } : {}),
        ...(onlyUnread ? { only_unread: true } : {}),
      },
      useAuth: true,
    }),

  // 未读汇总（GET /api/msg/mails/summary）：threads = 有未读的对话数，total = 未读条数
  getMailsSummary: () =>
    request("/msg/mails/summary", {
      method: "GET",
      useAuth: true,
    }),

  // 邮件详情（GET /api/msg/mails/:id）：返回 mail（这一封自身）+ replyChain（它回复过的链，
  // 时间倒序、只上溯、不含自身与后续回复）；id 传根或任意一条回复都行。
  getMail: (mailId) =>
    request(`/msg/mails/${mailId}`, {
      method: "GET",
      useAuth: true,
    }),

  // 标记已读（POST /api/msg/mails/:id/read）：逐封口径，无请求体；幂等，只影响这一封。
  markRead: (mailId) =>
    request(`/msg/mails/${mailId}/read`, {
      method: "POST",
      useAuth: true,
    }),

  // 发信（POST /api/msg/mails）：省略 replyTo 是发新邮件（subject 必填 1–80）；
  // 给了 replyTo 则是回复，主题由服务端按根主题生成，客户端传的 subject 会被忽略。
  // 玩家侧不传 channel：后端不再支持队伍内通讯，新邮件只会落在自己的账号级频道，
  // 面向官方的新邮件统一走下面的 feedback。
  sendMail: ({ subject, content, contentType = "text", replyTo } = {}) =>
    request("/msg/mails", {
      method: "POST",
      body: {
        ...(replyTo ? { reply_to: replyTo } : { subject }),
        content,
        content_type: contentType,
      },
      useAuth: true,
    }),

  // 问题反馈（POST /api/msg/feedback）：任何登录用户可用，不要求有队伍；subject 为主题
  feedback: ({ subject, content, contentType = "text" } = {}) =>
    request("/msg/feedback", {
      method: "POST",
      body: { subject, content, content_type: contentType },
      useAuth: true,
    }),

  // ---------- 求提示（两步付费：提问 → 看报价 → 确认才扣费） ----------

  // 提问（POST /api/msg/hint）：这一步不扣费、不发消息；每队同时只能有 1 条待报价
  requestHint: ({ content } = {}) =>
    request("/msg/hint", {
      method: "POST",
      body: { content },
      useAuth: true,
    }),

  // 查报价（GET /api/msg/hint/:id）：提问后 10 秒轮询一次，直到 status 不再是 pending；
  // 响应里永远没有答复正文（答复在确认扣费后才进队伍会话）。
  getHintRequest: (id) =>
    request(`/msg/hint/${id}`, {
      method: "GET",
      useAuth: true,
    }),

  // 申请更便宜（POST /api/msg/hint/:id/cheaper）：整个提问只允许 1 次，不扣费、不改价
  requestCheaperHint: (id) =>
    request(`/msg/hint/${id}/cheaper`, {
      method: "POST",
      body: {},
      useAuth: true,
    }),

  // 确认扣费（POST /api/msg/hint/:id/confirm）：按当前 quotedCost 扣本队 tips，并把答复发进队伍会话
  confirmHint: (id) =>
    request(`/msg/hint/${id}/confirm`, {
      method: "POST",
      body: {},
      useAuth: true,
    }),

  // 关闭（POST /api/msg/hint/:id/close）：放弃这条提示（服务端会清掉已备好的答复）
  closeHint: (id) =>
    request(`/msg/hint/${id}/close`, {
      method: "POST",
      body: {},
      useAuth: true,
    }),

  // 我的提示请求历史（GET /api/msg/hint-requests?cursor=&limit=），倒序游标分页，
  // 响应另带 pendingCount（当前占用「每队 1 条」名额的数量）
  getHintRequests: ({ cursor = 0, limit = 20 } = {}) =>
    request("/msg/hint-requests", {
      method: "GET",
      params: { cursor, limit },
      useAuth: true,
    }),
};

export default messageApi;
