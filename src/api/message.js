import request from "@/api/request";

/**
 * @file 站内信 / 公告 / 问题反馈 / 求提示（api-8-message-mail.md、api-10-tips-hints.md）。
 *
 * 所有 `/msg/*` 接口都要求登录（统一 `useAuth: true`），成功返回统一信封
 * `{ ok: true, data, req_id }`，失败时 `request` 抛出 {@link ApiError}。
 *
 * 关键语义：
 * - 列表按**邮件**粒度（不传 `threaded`）；正文只在详情里给，列表只有 `snippet`。
 * - `source` 由服务端决定、回复继承根的来源；
 * - 带附件的接口：先 `signMedia()` 直传，再把 `{ objectKey, filename, mime, sizeBytes }` 随请求提交（≤3 张）。
 * - 个人 / 队伍封禁期间除 `/me/*` 与申诉邮件附件外一律 `403 E_BANNED`。
 */

/**
 * 上传后的附件入参（先 `signMedia()` 直传再随业务请求提交）。
 * @typedef {Object} AttachmentInput
 * @property {string} objectKey 直传得到的对象键
 * @property {string} filename 原始文件名
 * @property {string} mime MIME 类型
 * @property {number} sizeBytes 字节数
 */

/**
 * 服务端下发的附件（读取时）。
 * @typedef {Object} AttachmentItem
 * @property {number} id 附件 id
 * @property {string} fileName 文件名
 * @property {string} mimeType MIME 类型
 * @property {number} size 字节数
 * @property {string} url 受保护路径 `/api/msg/media/<id>`，需带令牌取字节（见 `fetchMediaBlob()`）
 */

/**
 * 平铺口径下的一封邮件（列表行；详情里的 `mail` 在此基础上多几个字段）。
 * @typedef {Object} MailItem
 * @property {number} mailId 这一封的 id
 * @property {number} [threadId] 线程 id（仅详情 / 整线程返回）
 * @property {number|null} replyMsgId 直接父邮件；根邮件为 `null`
 * @property {number|null} rootMsgId 线程根；根邮件为 `null`
 * @property {boolean} isRoot 是否根邮件
 * @property {number} [replyLevel] 线程内层级（根 = 0；仅详情 / 整线程返回）
 * @property {"system"|"internal"|"account"|"team"} channel 频道
 * @property {string} channelName 频道展示名，如 `队伍会话 · 三人成行`
 * @property {"to_staff"|"to_player"} direction 玩家发出 / 官方发出
 * @property {"mail"|"feedback"|"hint"|"announce"|"warn"|"system"|"notice"|"appeal_ban"|"appeal_mute"} source
 *   来源（服务端决定，回复继承根）
 * @property {{ id: number|null, name: string|null, role: string|null }} from
 *   发送者；系统 / 官方公告三项均为 `null`
 * @property {string} subject 这一封自己的主题
 * @property {number} subjectLevel `0` = 开启新的主题基准（新邮件或中途改题）
 * @property {string} snippet 正文摘要（≤60 字符；只有图片时为 `[图片]`）
 * @property {string} createdAt 创建时间（ISO 8601）
 * @property {number} replyCount 线程级汇总（取根邮件）
 * @property {string} lastReplyAt 线程级汇总
 * @property {0|1} unread 我未读（自己发的为 `0`）
 * @property {0|1} answered 我回复过
 * @property {0|1} archived 我已归档
 * @property {0|1} hasAttachments 有图片附件
 * @property {0|1} canReply 允许回复（公告类 / 仅通知 / 求提示邮件为 `0`）
 * @property {0|1} shared 队伍共享邮箱（`channel=team` 时为 `1`）
 * @property {"inbox"|"sent"|"archive"|"all"} box 这一封当前所在文件夹
 * @property {number|null} ownerAccountId 所属账号（玩家侧通常为 `null`）
 * @property {string|null} ownerUsername 所属账号用户名
 * @property {string|null} ownerPlayerNo 所属账号玩家编号
 * @property {number|null} teamId 关联队伍 id
 * @property {string|null} teamName 关联队伍名
 */

/**
 * `GET /api/msg/mails/:id` 的 `data`。
 * @typedef {Object} MailDetailData
 * @property {MailItem & { content: string, contentType: "text"|"image", attachments: AttachmentItem[] }} mail
 *   请求的那一封；`content` / `contentType` / `attachments` 只在详情下发
 * @property {MailItem[]} replyChain 祖先链：时间倒序（最新祖先在前、根在最后），不含自身；
 *   根邮件的 `replyChain` 为 `[]`
 * @property {boolean} truncated `true` = 祖先超过 200 层，只返回最近 200 层
 */

/**
 * 求提示请求（`GET /api/msg/hint/:id` 的 `data`）。
 * @typedef {Object} HintRequest
 * @property {number} id 请求 id
 * @property {"pending"|"quoted"|"answered"|"rejected"|"closed"} status 状态机
 * @property {string} question 提问正文
 * @property {number|null} cost 已扣费用；确认前恒为 `null`
 * @property {number|null} quotedCost 当前有效报价（降价后即新价）
 * @property {string|null} quotedAt 报价时间
 * @property {string|null} cheaperRequestedAt 非 `null` = 已申请过更便宜（整个提问仅 1 次）
 * @property {string|null} cheaperDecidedAt 为空且上面非空 = 还在等官方回应
 * @property {boolean} isLowestPrice 官方已表示这是最低报价
 * @property {string} createdAt 创建时间
 * @property {string|null} decidedAt 处理时间
 * @property {number|null} replyMsgId 答复邮件 id（确认后才有）
 * @property {string|null} reason 拒绝原因
 * @property {number} pendingCount 占用「每队 1 条」名额的数量
 * @property {AttachmentItem[]} attachments 提问截图；无图为 `[]`
 * @property {number|null} [quoteMailId] 最近一次报价 / 改价邮件；`null` = 尚未报价
 * @property {number} [quoteCount] 报价 / 改价邮件总数
 * @property {number} [accountId] 所属账号（历史列表用）
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

export const messageApi = {
  /**
   * 邮件列表（平铺粒度，每次发信一行，倒序分页）。
   *
   * - 接口：`GET /api/msg/mails`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.1
   *
   * `sinceId > 0` 时切换为「取更新」：按 id 正序、忽略 `cursor`。
   * 正文不在列表里（只有 `snippet`），需要正文请用 `getMail()`。
   *
   * @param {Object} query
   * @param {number} [query.cursor=0] 上一页的 `nextCursor`
   * @param {number} [query.sinceId=0] 大于 0 时按 id 正序拉新
   * @param {number} [query.limit=20] 每页条数（1–50）
   * @param {"inbox"|"sent"|"archive"|"all"} [query.box="inbox"] 文件夹；
   *   默认只给收件箱，自己发的在 `sent`
   * @param {"system"|"internal"|"account"|"team"} [query.channel] 频道过滤
   * @param {string} [query.source] 来源过滤（`mail` / `feedback` / `hint` / `announce` 等），服务端过滤
   * @param {0|1} [query.answered] `0` = 只看未回复、`1` = 只看已回复
   * @param {boolean} [query.onlyUnread] 只看未读
   * @returns {Promise<{ ok: boolean, data: {
   *   items: MailItem[], nextCursor: number|null, hasMore: boolean }, req_id: string }>}
   *   data.items -- 本页邮件（平铺；默认倒序，`since_id` 模式下为正序）
   *   data.nextCursor -- 下一页游标；`null` 表示没有更多（`since_id` 模式恒为 `null`）
   *   data.hasMore -- 是否还有下一页
   *   `nextCursor` 传回 `cursor`。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：`limit` 越界，或 `since_id` 与 `threaded=1` 同用（本封装不传 `threaded`）
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   */
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

  /**
   * 未读汇总（角标轮询用，页面隐藏时停止）。
   *
   * - 接口：`GET /api/msg/mails/summary`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.2
   *
   * 只按**封**统计、不含自己发的；**不要缓存**。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   inbox: { unread: number }, archive: { unread: number } }, req_id: string }>}
   *   data.inbox.unread -- 收件箱未读封数
   *   data.archive.unread -- 归档箱未读封数
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   */
  getMailsSummary: () =>
    request("/msg/mails/summary", {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 单封详情：这一封 + 它的祖先链（不返回后续回复或旁支）。
   *
   * - 接口：`GET /api/msg/mails/:id`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.3
   *
   * @param {number} mailId 邮件 id
   * @returns {Promise<{ ok: boolean, data: MailDetailData, req_id: string }>}
   *   `replyChain` 沿 `replyMsgId` 上溯、时间倒序且不含自身。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：无权访问这一封（如他人账号频道）
   *   - 404 `E_NOT_FOUND`：邮件不存在
   */
  getMail: (mailId) =>
    request(`/msg/mails/${mailId}`, {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 标记单封已读（逐封口径，幂等）。
   *
   * - 接口：`POST /api/msg/mails/:id/read`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.5
   *
   * 只影响这一封；重复调用不报错，`readAt` 保持首次时间。
   *
   * @param {number} mailId 邮件 id
   * @returns {Promise<{ ok: boolean, data: {
   *   mailId: number, unread: 0, readAt: string|null }, req_id: string }>}
   *   data.mailId -- 这一封的 id（回显请求值）
   *   data.unread -- 固定 `0`（已读）
   *   data.readAt -- 首次标记时间（ISO 8601）；自己发的邮件为 `null`
   *   同一封重复标记时 `readAt` 保持首次时间。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：无权操作这一封
   *   - 404 `E_NOT_FOUND`：邮件不存在
   */
  markRead: (mailId) =>
    request(`/msg/mails/${mailId}/read`, {
      method: "POST",
      useAuth: true,
    }),

  /**
   * 批量已读（`ids` / `rootId` / `all` 三选一）。
   *
   * - 接口：`POST /api/msg/mails/read`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.6
   *
   * 只标记**非本人发送**的邮件；幂等。
   *
   * @param {Object} payload
   * @param {number[]} [payload.ids] 最多 100 封
   * @param {number} [payload.rootId] 整条线程（根邮件 id）
   * @param {boolean} [payload.all] 当前可见的全部未读
   * @returns {Promise<{ ok: boolean, data: { marked: number }, req_id: string }>}
   *   data.marked -- 实际标记的封数（已读的、自己发的会被跳过）
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：三项一项都没给，或 `ids` 超过 100
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：无权操作其中的邮件
   */
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

  /**
   * 归档 / 取消归档（`ids` 或 `rootId` 二选一，`archived` 必填）。
   *
   * - 接口：`POST /api/msg/mails/archive`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.7
   *
   * 归档**不改变已读状态**，只把邮件移出 `inbox` / `sent`；取消归档后回到原文件夹。
   * `includeUnread=false` 时归档跳过未读的非本人邮件；自己发的邮件不受该开关影响。
   *
   * @param {Object} payload
   * @param {number[]} [payload.ids] 最多 100 封
   * @param {number} [payload.rootId] 整条线程（根邮件 id）
   * @param {boolean} payload.archived `true` 归档，`false` 取消归档
   * @param {boolean} [payload.includeUnread=true] `false` 时跳过未读的非本人邮件
   * @returns {Promise<{ ok: boolean, data: {
   *   archived: boolean, count: number }, req_id: string }>}
   *   data.archived -- 回显本次操作（`true` 归档 / `false` 取消归档）
   *   data.count -- 实际变更的封数
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：`ids` / `rootId` 都没给，或 `ids` 超过 100
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：无权操作其中的邮件
   */
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

  /**
   * 发信 / 回复。
   *
   * - 接口：`POST /api/msg/mails`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.4
   *
   * - 省略 `replyTo` = 发新邮件：`subject` 必填（1–80 字），`channel` 可选（默认 `account`）。
   * - 给了 `replyTo` = 回复：`subject` 可省略（服务端生成「回复：…」），传非空值 = **中途改题**。
   * - 正文必填（不能只发图没有正文）；`source` 由服务端决定，回复继承根的来源。
   * - 玩家侧新邮件目前统一走 `feedback()`（不受发信开关影响），所以 `channel` 基本用不到。
   *
   * @param {Object} payload
   * @param {string} [payload.subject] 主题（1–80 字）；回复时可省略
   * @param {string} payload.content 正文（1–2000 字）
   * @param {"text"|"image"} [payload.contentType="text"] 正文类型
   * @param {number} [payload.replyTo] 要回复的邮件 id；省略 = 发新邮件
   * @param {"account"|"team"} [payload.channel] 仅发新邮件时有效，默认 `account`
   * @param {AttachmentInput[]} [payload.attachments] 图片附件，≤3 张
   * @returns {Promise<{ ok: boolean, data: {
   *   mailId: number, replyMsgId: number|null, rootMsgId: number|null,
   *   subject: string, source: string, channel: string, channelName: string,
   *   direction: "to_staff"|"to_player", attachments: AttachmentItem[],
   *   createdAt: string }, req_id: string }>}
   *   data.mailId -- 新邮件的 id
   *   data.replyMsgId -- 直接父邮件；新邮件为 `null`
   *   data.rootMsgId -- 线程根；新邮件为 `null`
   *   data.subject -- 实际主题（回复时含服务端生成的「回复：」前缀）
   *   data.source -- 服务端判定的来源（回复继承根的来源）
   *   data.channel -- 频道（`account` / `team`）
   *   data.channelName -- 频道展示名
   *   data.direction -- `to_staff` 表示玩家发出
   *   data.attachments -- 本条实际写入的附件；没带时为 `[]`
   *   data.createdAt -- 创建时间（ISO 8601）
   *   成功状态码为 201。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：主题 / 正文非法、`reply_to` 非法或回复层级过深
   *     detail.fields：
   *       `subject` -- 新邮件缺失 / 空白 / 超过 80 字
   *       `content` -- 缺失 / 空 / 超过 2000 字
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_MUTED`：被禁言（禁言期间所有发信动作都被拦）
   *   - 403 `E_FORBIDDEN`：回复公告 / 内部公告 / 仅通知 / 他人邮件，或玩家发信开关关闭
   *     detail.reason_code：
   *       `HINT_REPLY_CLOSED` -- 回复的是求提示邮件；引导到「求提示」页查看
   *   - 404 `E_NOT_FOUND`：`reply_to` 指向的邮件不存在
   *   - 409 `E_CONFLICT`：发到队伍频道但没有队伍
   *   - 429 `E_QUOTA`：发送过于频繁
   */
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

  /**
   * 问题反馈：向「与官方的联系」频道发一封新邮件（**没有队伍也能用**）。
   *
   * - 接口：`POST /api/msg/feedback`
   * - 鉴权：需要访问令牌
   * - 文档：api-8-message-mail.md §8.9
   *
   * 固定落在自己的账号级频道、来源固定 `feedback`，不受玩家发信开关影响；被禁言时仍会被拦。
   * 响应沿用历史形状（用 `id` 而不是 `mailId`）；需要统一形状时回读列表 / 详情。
   *
   * @param {Object} payload
   * @param {string} [payload.subject] 主题（1–80 字）；不传 / 空白时取正文首行
   * @param {string} payload.content 正文（1–2000 字）
   * @param {"text"|"image"} [payload.contentType="text"] 正文类型
   * @param {AttachmentInput[]} [payload.attachments] 图片附件，≤3 张
   * @returns {Promise<{ ok: boolean, data: {
   *   id: number, threadId: number, senderId: number, direction: "to_staff",
   *   contentType: "text"|"image", content: string, subject: string,
   *   source: "feedback", attachments: AttachmentItem[], createdAt: string }, req_id: string }>}
   *   data.id -- 邮件 id（历史形状用 `id`，不是 `mailId`）
   *   data.threadId -- 线程 id
   *   data.senderId -- 发送者账号 id
   *   data.direction -- 固定 `to_staff`（玩家发给官方）
   *   data.contentType -- 正文类型
   *   data.content -- 正文
   *   data.subject -- 主题（未传 / 空白时取正文首行）
   *   data.source -- 固定 `feedback`
   *   data.attachments -- 本条实际写入的附件；没带时为 `[]`
   *   data.createdAt -- 创建时间（ISO 8601）
   *   成功状态码为 201。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：正文缺失 / 超长等，见 `detail.fields`
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_MUTED`：被禁言
   *   - 429 `E_QUOTA`：提交过于频繁
   */
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

  /**
   * 求提示·提问。
   *
   * - 接口：`POST /api/msg/hint`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.3
   *
   * 这一步**不扣费、不往会话发消息**；每队同时只能有 1 条 `pending`（待报价）。
   * 截图会展示给 staff 作为报价依据。
   *
   * @param {Object} payload
   * @param {string} payload.content 提问正文（1–2000 字，必填）
   * @param {AttachmentInput[]} [payload.attachments] 提问截图，≤3 张
   * @returns {Promise<{ ok: boolean, data: {
   *   requestId: number, status: "pending", question: string,
   *   cost: null, quotedCost: null, balance: number, pendingCount: number,
   *   attachments: AttachmentItem[] }, req_id: string }>}
   *   data.requestId -- 新建的求提示请求 id（后续接口的 `id`）
   *   data.status -- 固定 `pending`（等待官方报价）
   *   data.question -- 提问正文（回显）
   *   data.cost -- 固定 `null`（这一步不扣费）
   *   data.quotedCost -- 固定 `null`（尚未报价）
   *   data.balance -- 本队当前 tips 余额
   *   data.pendingCount -- 本次提交后占用「每队 1 条」名额的数量
   *   data.attachments -- 提问截图；无图时为 `[]`
   *   成功状态码为 201。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：正文缺失或超过 2000 字，见 `detail.fields.content`
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：队伍已被官方封禁（`detail.reason` / `detail.until`）
   *   - 403 `E_MUTED`：被禁言（提问属于发信动作）
   *   - 403 `MSG_IMAGE_DISABLED`：附件功能未开启却带了截图
   *   - 409 `E_CONFLICT`：门禁不通（`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`），
   *     或已有 1 条待报价提问（`最多同时提交 1 条求提示，请等官方报价或先关闭`）
   */
  requestHint: ({ content, attachments } = {}) =>
    request("/msg/hint", {
      method: "POST",
      body: {
        content,
        ...(attachments?.length ? { attachments } : {}),
      },
      useAuth: true,
    }),

  /**
   * 求提示·查报价（提问后每 10 秒轮询，直到 `status` 不再是 `pending`）。
   *
   * - 接口：`GET /api/msg/hint/:id`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.4
   *
   * 响应里**永远没有答复正文**：答复只有确认扣费后才以消息形式进队伍会话。
   * `cost` 在确认前恒为 `null`，报价看 `quotedCost`。
   *
   * @param {number} id 求提示请求 id
   * @returns {Promise<{ ok: boolean, data: HintRequest, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：`你不在该请求所属队伍里`
   *   - 404 `E_NOT_FOUND`：`提示请求不存在`
   */
  getHintRequest: (id) =>
    request(`/msg/hint/${id}`, {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 求提示·申请更便宜（整个提问只允许 1 次，不扣费、不改价）。
   *
   * - 接口：`POST /api/msg/hint/:id/cheaper`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.4b、§10.16.2
   *
   * 可选 `content` / `attachments` 会构成「申请更便宜」邮件的正文与图片（2026-11-13 起）；
   * 都不带时服务端沿用默认文案，且**不做禁言拦截**。
   *
   * ⚠ 前端必做：发请求**之前**弹确认，文案逐字为
   * 「更便宜的提示可能无法回答所有问题，确定要申请吗？」——后端不提供这句话。
   *
   * @param {number} id 求提示请求 id
   * @param {Object} [payload]
   * @param {string} [payload.content] 自定义说明（1–2000 字）；不传则用默认文案
   * @param {AttachmentInput[]} [payload.attachments] 截图，≤3 张
   * @returns {Promise<{ ok: boolean, data: {
   *   requested: true, requestId: number, status: string, quotedCost: number,
   *   cheaperRequestedAt: string, cheaperMailId: number }, req_id: string }>}
   *   data.requested -- 恒为 `true`
   *   data.requestId -- 求提示请求 id
   *   data.status -- 当前业务状态（申请不改状态，通常仍是 `quoted`）
   *   data.quotedCost -- 当前有效报价（申请不改价）
   *   data.cheaperRequestedAt -- 本次申请时间（ISO 8601）
   *   data.cheaperMailId -- 「申请更便宜」邮件的 id
   *   成功状态码为 200（对既有请求的一次动作）。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：自定义正文超长或附件超限，见 `detail.fields`
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_MUTED`：带自定义正文 / 附件且被禁言
   *   - 403 `E_FORBIDDEN`：`你不在该请求所属队伍里`
   *   - 404 `E_NOT_FOUND`：提示请求不存在
   *   - 409 `E_CONFLICT`：还没报价 / 已经申请过一次 / 官方已表示最低报价 / 该请求已处理
   */
  requestCheaperHint: (id, { content, attachments } = {}) =>
    request(`/msg/hint/${id}/cheaper`, {
      method: "POST",
      body: {
        ...(content ? { content } : {}),
        ...(attachments?.length ? { attachments } : {}),
      },
      useAuth: true,
    }),

  /**
   * 求提示·确认扣费：按**当前** `quotedCost` 扣本队 tips，并把答复发进队伍会话。
   *
   * - 接口：`POST /api/msg/hint/:id/confirm`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.5
   *
   * 前置：`status === "quoted"`。**幂等**：重复点确认不会重复扣费；失败重试也安全。
   * 降价后必须重新确认（确认前以最新 `quotedCost` 为准）。
   *
   * @param {number} id 求提示请求 id
   * @returns {Promise<{ ok: boolean, data: {
   *   confirmed: true, requestId: number, status: "answered",
   *   cost: number, balance: number, msgId: number }, req_id: string }>}
   *   data.confirmed -- 恒为 `true`
   *   data.requestId -- 求提示请求 id
   *   data.status -- 固定 `answered`
   *   data.cost -- 本次实际扣费额（= 确认时的 `quotedCost`）
   *   data.balance -- 扣费后的本队余额
   *   data.msgId -- 答复发进队伍会话后的邮件 id
   * @throws {ApiError}
   *   - 400 `E_TIPS_SHORT`：本队 tips 不足（`detail.balance` / `detail.required`）；
   *     报价保留，补点数后重试本接口即可
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：`你不在该请求所属队伍里`
   *   - 404 `E_NOT_FOUND`：提示请求不存在
   *   - 409 `E_CONFLICT`：该请求已处理（已关闭 / 已拒绝 / 已确认）
   *   - 500 `E_INTERNAL`：答复发送失败（重试不会二次扣费）
   */
  confirmHint: (id) =>
    request(`/msg/hint/${id}/confirm`, {
      method: "POST",
      body: {},
      useAuth: true,
    }),

  /**
   * 求提示·关闭：放弃这条提示（服务端会清空已备好的答复与议价标记）。
   *
   * - 接口：`POST /api/msg/hint/:id/close`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.6
   *
   * `pending` / `quoted` 关闭时 `refunded: 0`（本来就没扣费）；极罕见「已扣费但答复没发出去」
   * 会全额退回（幂等）。
   *
   * @param {number} id 求提示请求 id
   * @returns {Promise<{ ok: boolean, data: {
   *   closed: true, requestId: number, status: "closed", refunded: number }, req_id: string }>}
   *   data.closed -- 恒为 `true`
   *   data.requestId -- 求提示请求 id
   *   data.status -- 固定 `closed`
   *   data.refunded -- 退回的 tips；未扣费的情形为 `0`
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 403 `E_FORBIDDEN`：`你不在该请求所属队伍里`
   *   - 404 `E_NOT_FOUND`：提示请求不存在
   *   - 409 `E_CONFLICT`：该请求已处理（已答复 / 已拒绝 / 已关闭）
   */
  closeHint: (id) =>
    request(`/msg/hint/${id}/close`, {
      method: "POST",
      body: {},
      useAuth: true,
    }),

  /**
   * 我的求提示历史（倒序游标分页）。
   *
   * - 接口：`GET /api/msg/hint-requests`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.7
   *
   * 列表项是求提示请求的安全快照（**不含答复正文**）；`pendingCount` 是当前占用
   * 「每队 1 条」名额的数量。没有队伍时返回空页（`items: []`、`pendingCount: 0`），不是 409。
   *
   * @param {Object} query
   * @param {number} [query.cursor=0] 上一页的 `nextCursor`
   * @param {number} [query.limit=20] 每页条数（最大 100）
   * @returns {Promise<{ ok: boolean, data: {
   *   items: HintRequest[], nextCursor: number|null, hasMore: boolean,
   *   pendingCount: number }, req_id: string }>}
   *   data.items -- 求提示请求列表（倒序）
   *   data.nextCursor -- 下一页游标；`null` 表示没有更多
   *   data.hasMore -- 是否还有下一页
   *   data.pendingCount -- 当前占用「每队 1 条」名额的数量
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   */
  getHintRequests: ({ cursor = 0, limit = 20 } = {}) =>
    request("/msg/hint-requests", {
      method: "GET",
      params: { cursor, limit },
      useAuth: true,
    }),
};

export default messageApi;
