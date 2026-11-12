import request from "@/api/request";

// 站内信与官方公告接口：所有 /api/msg/* 均要求登录，统一 useAuth: true。
// 成功响应为 { ok: true, data, req_id }；失败为 { ok: false, error: { code, message, detail }, req_id }。
// 失败时 request 抛出的 Error 带 status / code / payload，调用方读取 error.payload.error.message。
export const messageApi = {
  // 邮件列表（GET /api/msg/mails）：每次发信一行，倒序分页（前端固定按「邮件」粒度，不用 threaded）；
  // sinceId > 0 时切换为「取更新」（按 id 正序，忽略 cursor 与 threaded —— 我们不传 threaded）。
  // 2026-11-11（mistarg.2.0.0）起新增 box/source/answered：
  //   · box: inbox（默认）/ sent / archive / all —— 默认只给收件箱，自己发的邮件在 sent
  //   · source: 见 api-8 的 source 枚举，服务端过滤（不再由前端筛）
  //   · answered: 0 = 只看未回复、1 = 只看已回复
  getMails: ({
    cursor = 0,
    sinceId = 0,
    limit = 20,
    box,
    channel,
    source,
    answered,
    onlyUnread,
  } = {}) =>
    request("/msg/mails", {
      method: "GET",
      params: {
        cursor,
        since_id: sinceId,
        limit,
        ...(box ? { box } : {}),
        ...(channel ? { channel } : {}),
        ...(source ? { source } : {}),
        ...(answered === 0 || answered === 1 ? { answered } : {}),
        ...(onlyUnread ? { only_unread: true } : {}),
      },
      useAuth: true,
    }),

  // 未读汇总（GET /api/msg/mails/summary）：2026-11-11 起为嵌套形状
  // { inbox: { unread }, archive: { unread } }，只按「封」统计、不含自己发的。
  getMailsSummary: () =>
    request("/msg/mails/summary", {
      method: "GET",
      useAuth: true,
    }),

  // 邮件详情（GET /api/msg/mails/:id）：返回 mail（这一封自身，带 content / attachments）+
  // replyChain（它回复过的链，时间倒序、只上溯、不含自身与后续回复）+ truncated（祖先超 200 层）。
  // 正文只在详情里给（列表只有 snippet）；前端的详情页用的就是这个接口。
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

  // 批量已读（POST /api/msg/mails/read，2026-11-11 新增）：三选一
  //   { ids: [≤100] } / { rootId }（整条线程）/ { all: true }（当前可见的全部未读）
  // 只标记非本人发送的邮件；幂等。
  markReadBatch: ({ ids, rootId, all } = {}) =>
    request("/msg/mails/read", {
      method: "POST",
      body: {
        ...(Array.isArray(ids) && ids.length ? { ids } : {}),
        ...(rootId ? { root_id: rootId } : {}),
        ...(all ? { all: true } : {}),
      },
      useAuth: true,
    }),

  // 归档 / 取消归档（POST /api/msg/mails/archive，2026-11-11 新增）：
  // { ids: [≤100] } 或 { rootId }（整条线程），archived 必填；
  // includeUnread=false 时归档跳过未读的非本人邮件（默认 true）。
  archiveMails: ({ ids, rootId, archived, includeUnread } = {}) =>
    request("/msg/mails/archive", {
      method: "POST",
      body: {
        ...(Array.isArray(ids) && ids.length ? { ids } : {}),
        ...(rootId ? { root_id: rootId } : {}),
        archived: Boolean(archived),
        ...(includeUnread === false ? { include_unread: false } : {}),
      },
      useAuth: true,
    }),

  // 发信（POST /api/msg/mails）：
  //   · 省略 replyTo 是发新邮件（subject 必填 1–80；channel 可选 account / team，默认 account）
  //   · 给了 replyTo 是回复：subject 可省略（服务端生成「回复：…」），传非空值 = 中途改题
  // 玩家侧的新邮件目前统一走下面的 feedback（不受发信开关影响），所以 channel 基本用不到。
  // attachments（2026-10-31 起）：[{ objectKey, filename, mime, sizeBytes }]，≤3 张，新邮件与回复都支持。
  sendMail: ({
    subject,
    content,
    contentType = "text",
    replyTo,
    channel,
    attachments,
  } = {}) =>
    request("/msg/mails", {
      method: "POST",
      body: {
        ...(subject ? { subject } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(!replyTo && channel ? { channel } : {}),
        content,
        content_type: contentType,
        ...(attachments?.length ? { attachments } : {}),
      },
      useAuth: true,
    }),

  // 问题反馈（POST /api/msg/feedback）：任何登录用户可用，不要求有队伍；subject 为主题。
  // attachments 同 sendMail（≤3 张图片）。
  feedback: ({ subject, content, contentType = "text", attachments } = {}) =>
    request("/msg/feedback", {
      method: "POST",
      body: {
        subject,
        content,
        content_type: contentType,
        ...(attachments?.length ? { attachments } : {}),
      },
      useAuth: true,
    }),

  // ---------- 求提示（两步付费：提问 → 看报价 → 确认才扣费） ----------

  // 提问（POST /api/msg/hint）：这一步不扣费、不发消息；每队同时只能有 1 条待报价。
  // attachments（2026-10-31 起）：提问截图 ≤3 张，staff 在求提示工作台可见（报价依据）。
  requestHint: ({ content, attachments } = {}) =>
    request("/msg/hint", {
      method: "POST",
      body: {
        content,
        ...(attachments?.length ? { attachments } : {}),
      },
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
