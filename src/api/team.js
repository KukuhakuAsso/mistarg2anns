import request from "@/api/request";

/**
 * @file 队伍接口（api-7-team.md）。
 *
 * 所有 `/api/team/*` 都要求登录（统一 `useAuth: true`）；**唯一例外**是 `nameAvailable()`
 * （匿名，`skipRefresh`）。成功返回统一信封 `{ ok: true, data, req_id }`，失败时
 * `request` 抛出 {@link ApiError}。
 *
 */

/**
 * 队伍成员。
 * @typedef {Object} TeamMember
 * @property {number} accountId 账号 id
 * @property {string} playerNo 玩家编号（camelCase，与登录响应的 `player_no` 不同）
 * @property {string} username 用户名（当前值）
 * @property {"captain"|"member"} role 角色
 * @property {string} joinedAt 入队时间（ISO 8601）
 */

/**
 * 队伍进度。
 * @typedef {Object} TeamProgress
 * @property {number} solvedCount 已解出数量
 * @property {number} score 得分
 * @property {string|null} firstSolveAt 首次解出时间
 * @property {string|null} lastSolveAt 最近一次解出时间
 */

/**
 * 待队长确认的加入申请。
 * @typedef {Object} TeamPendingRequest
 * @property {number} id 申请 id
 * @property {number} accountId 申请人账号 id
 * @property {string} playerNo 申请人玩家编号
 * @property {string} username 申请人用户名
 * @property {string} createdAt 申请时间（ISO 8601）
 */

/**
 * 队伍详情（`getMyTeam()` / `getTeam()` 的 `team`）。
 * @typedef {Object} TeamDetail
 * @property {number} id 队伍 id（唯一标识）
 * @property {string} name 队名
 * @property {string|null} intro 队伍简介
 * @property {number} captainId 队长账号 id
 * @property {2|3|4} status 统一码表：2 正常 / 3 禁言 / 4 封禁（1 已解散不会返回；到期自动归 2）
 * @property {string|null} banReason 仅 `status=4` 有值
 * @property {string|null} banUntil 仅 `status=4`；`null` = 永久
 * @property {string|null} muteReason 仅 `status=3` 有值
 * @property {string|null} muteUntil 仅 `status=3`；`null` = 永久
 * @property {string} createdAt 建队时间（ISO 8601）
 * @property {boolean} autoApprove 是否自动审批入队申请
 * @property {string|null} confirmedAt 确认参赛时间；`null` = 未确认
 * @property {string|null} startedAt `max(确认时刻, 官方开赛时间)`；未确认时 `null`
 * @property {string|null} inviteCode 邀请码；**仅本队成员可见**，其他人 `null`
 * @property {TeamMember[]} members 成员列表
 * @property {TeamProgress} progress 队伍进度
 * @property {number} milestoneCount 已达成里程碑数
 * @property {number} maxSize 队伍人数上限
 * @property {TeamPendingRequest[]} pendingRequests 待确认申请；**仅队长可见**，其他成员为 `[]`
 */

/**
 * 建队响应里的队伍摘要。
 * @typedef {Object} TeamBasic
 * @property {number} id 队伍 id
 * @property {string} name 队名
 * @property {string|null} intro 队伍简介
 * @property {number} captainId 队长账号 id
 * @property {2|3|4} status 队伍状态
 * @property {boolean} autoApprove 是否自动审批
 * @property {string|null} confirmedAt 确认参赛时间
 * @property {string|null} startedAt 实际开赛时间
 * @property {string|null} inviteCode 邀请码
 * @property {string} createdAt 建队时间
 */

/**
 * 加入申请（`getMyTeam()` 的 `myJoinRequest` 与 `applyJoin()` 的 `request`）。
 * @typedef {Object} TeamJoinRequest
 * @property {number} id 申请 id
 * @property {number} teamId 队伍 id
 * @property {string} [teamName] 队伍名（`myJoinRequest` / 普通申请时带）
 * @property {"pending"|"approved"|"rejected"|"cancelled"} status 申请状态
 * @property {boolean} [autoApproved] 仅自动审批通过时为 `true`
 * @property {string} createdAt 申请时间（ISO 8601）
 * @property {string|null} [decidedAt] 处理时间
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

export const teamApi = {
  /**
   * 读取我的队伍与我的加入申请。
   *
   * - 接口：`GET /api/team/me`
   * - 鉴权：需要访问令牌
   * - 文档：api-7-team.md §7.1
   *
   * 未入队时 `team: null`，`myJoinRequest` 只有在存在待审 / 已拒绝申请时才有值。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   team: TeamDetail|null, myJoinRequest: TeamJoinRequest|null }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：个人封禁（队伍处罚不影响读取）
   */
  getMyTeam: () =>
    request("/team/me", {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 读取指定队伍详情。
   *
   * - 接口：`GET /api/team/:id`
   * - 鉴权：需要访问令牌
   * - 文档：api-7-team.md §7.3
   *
   * `inviteCode` 只对本队成员可见；`pendingRequests` 只对队长可见。
   *
   * @param {number} teamId 队伍 id
   * @returns {Promise<{ ok: boolean, data: { team: TeamDetail }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：个人封禁
   *   - 404 `E_NOT_FOUND`：队伍不存在或已解散（已解散的队伍不会返回）
   */
  getTeam: (teamId) =>
    request(`/team/${teamId}`, {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 队名可用性检查（建队表单实时校验）。
   *
   * - 接口：`POST /api/team/name-available`
   * - 鉴权：**不需要登录**（本章唯一匿名接口）
   * - 文档：api-7-team.md §7.13
   *
   * @param {string} name 待检查的队名（1–32 个字符；首尾空白与 NFC 由服务端归一化）
   * @returns {Promise<{ ok: boolean, data: {
   *   status: "available"|"taken", available: boolean, name: string }, req_id: string }>}
   *   `name` 是归一化后的值：与输入不同即说明含组合字符或首尾空格，可直接回写输入框。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：队名缺失 / 超 32 字符 / 含 emoji、不可见字符等
   *     detail.fields：
   *       `name` -- 与建队同一套规则的原因（可直接展示）
   *   - 429 `E_QUOTA`：检查过于频繁（20 次/秒；每账号或 IP 每天 200 次）
   */
  nameAvailable: (name) =>
    request("/team/name-available", {
      method: "POST",
      body: { name },
      skipRefresh: true,
    }),

  /**
   * 创建队伍。
   *
   * - 接口：`POST /api/team`
   * - 鉴权：需要访问令牌
   * - 文档：api-7-team.md §7.2
   *
   * 建队前建议先调 `nameAvailable()` 做实时校验，但最终判定仍以本接口为准。
   *
   * @param {Object} payload
   * @param {string} payload.name 队名（1–32 个字符，按字符计）
   * @param {string} [payload.intro] 队伍简介（≤200 字）
   * @returns {Promise<{ ok: boolean, data: { team: TeamBasic }, req_id: string }>}
   *   成功状态码为 201。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：队名缺失 / 超长 / 含 emoji 或不可见字符
   *     detail.fields：
   *       `name` -- 具体原因（可直接展示）
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：个人封禁
   *   - 409 `E_CONFLICT`：`你已经在一支队伍里，请先退出` / `该队名已被占用（不区分大小写）`
   */
  createTeam: ({ name, intro } = {}) =>
    request("/team", {
      method: "POST",
      body: {
        name,
        ...(intro ? { intro } : {}),
      },
      useAuth: true,
    }),

  /**
   * 更换邀请码（队长）。
   *
   * - 接口：`POST /api/team/invite`
   * - 鉴权：需要访问令牌 + 队长 + 未确认参赛
   * - 文档：api-7-team.md §7.4
   *
   * 旧码在同一次更新里立即失效。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, code: string }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁（`只有队长可以执行该操作`）
   *   - 409 `E_CONFLICT`：队伍已确认参赛（`队伍已确认参赛，该操作已锁定`）
   */
  rotateInvite: () =>
    request("/team/invite", {
      method: "POST",
      useAuth: true,
    }),

  /**
   * 开关自动审批（队长）。
   *
   * - 接口：`POST /api/team/join/auto-approve`
   * - 鉴权：需要访问令牌 + 队长 + 未确认参赛
   * - 文档：api-7-team.md §7.5
   *
   * 开启后凭邀请码申请会**直接通过并入队**（仍留一条 `approved` + `autoApproved: true`
   * 的申请记录）。
   *
   * @param {boolean} enabled 是否开启自动审批
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, autoApprove: boolean }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 409 `E_CONFLICT`：队伍已确认参赛（`队伍已确认参赛，该操作已锁定`）
   */
  setAutoApprove: (enabled) =>
    request("/team/join/auto-approve", {
      method: "POST",
      body: { enabled: Boolean(enabled) },
      useAuth: true,
    }),

  /**
   * 凭邀请码申请加入队伍。
   *
   * - 接口：`POST /api/team/join`
   * - 鉴权：需要访问令牌
   * - 文档：api-7-team.md §7.6
   *
   * `joined` 是关键分支：`false` = 只提交了申请（`request.status="pending"`）；
   * `true` = 队伍开了自动审批，已直接入队（额外带 `teamId` / `teamName`，
   * `request.status="approved"` + `autoApproved: true`）。
   *
   * @param {string} code 邀请码（服务端 trim 并转大写）
   * @returns {Promise<{ ok: boolean, data: {
   *   joined: boolean, teamId?: number, teamName?: string,
   *   request: TeamJoinRequest }, req_id: string }>}
   *   成功状态码为 201。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：邀请码为空（`detail.fields.code`）
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：个人封禁
   *   - 404 `E_NOT_FOUND`：`邀请码无效`
   *   - 409 `E_CONFLICT`：`该队伍已被官方封禁` / `该队伍已解散` / `该队伍已确认参赛，无法申请加入` /
   *     `你已经在这支队伍里了` / `你已经在一支队伍里，请先退出` /
   *     `你已有一条待确认的加入申请` / `队伍已满（上限 5 人）`
   */
  applyJoin: (code) =>
    request("/team/join", {
      method: "POST",
      body: { code },
      useAuth: true,
    }),

  /**
   * 队长同意一条加入申请。
   *
   * - 接口：`POST /api/team/join/confirm`
   * - 鉴权：需要访问令牌 + 队长 + 未确认参赛
   * - 文档：api-7-team.md §7.7.1
   *
   * @param {number} requestId 申请 id
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, requestId: number, accountId: number }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 404 `E_NOT_FOUND`：`申请不存在`
   *   - 409 `E_CONFLICT`：`该申请已处理` / `队伍已确认参赛，该操作已锁定` /
   *     `队伍已满（上限 5 人）` / `该玩家已经在一支队伍里`
   */
  confirmJoin: (requestId) =>
    request("/team/join/confirm", {
      method: "POST",
      body: { request_id: requestId },
      useAuth: true,
    }),

  /**
   * 队长拒绝一条加入申请。
   *
   * - 接口：`POST /api/team/join/reject`
   * - 鉴权：需要访问令牌 + 队长 + 未确认参赛
   * - 文档：api-7-team.md §7.7.2
   *
   * @param {number} requestId 申请 id
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, requestId: number, status: "rejected" }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 404 `E_NOT_FOUND`：`申请不存在`
   *   - 409 `E_CONFLICT`：`该申请已处理` / `队伍已确认参赛，该操作已锁定`
   */
  rejectJoin: (requestId) =>
    request("/team/join/reject", {
      method: "POST",
      body: { request_id: requestId },
      useAuth: true,
    }),

  /**
   * 申请人取消自己的待确认申请。
   *
   * - 接口：`POST /api/team/join/cancel`
   * - 鉴权：需要访问令牌
   * - 文档：api-7-team.md §7.8
   *
   * 不受开赛锁约束：它不改变任何队伍结构，避免申请人在目标队确认参赛后被卡住。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   cancelled: true, status: "cancelled" }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 404 `E_NOT_FOUND`：`你没有待确认的加入申请`
   */
  cancelJoin: () =>
    request("/team/join/cancel", {
      method: "POST",
      useAuth: true,
    }),

  /**
   * 队长确认参赛（确认后队伍进入锁定态）。
   *
   * - 接口：`POST /api/team/start`
   * - 鉴权：需要访问令牌 + 队长
   * - 文档：api-7-team.md §7.9.1
   *
   * `startedAt` 是 `max(确认时刻, 官方开赛时间)`。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, confirmedAt: string, startedAt: string }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 409 `E_CONFLICT`：`队伍已确认参赛`（重复点击）
   */
  startTeam: () =>
    request("/team/start", {
      method: "POST",
      useAuth: true,
    }),

  /**
   * 队长取消确认参赛（仅官方开赛前可用）。
   *
   * - 接口：`POST /api/team/start/cancel`
   * - 鉴权：需要访问令牌 + 队长
   * - 文档：api-7-team.md §7.9.2
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, confirmed: false }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 409 `E_CONFLICT`：`比赛已开始，无法取消确认参赛` / `队伍尚未确认参赛`
   */
  cancelStart: () =>
    request("/team/start/cancel", {
      method: "POST",
      useAuth: true,
    }),

  /**
   * 队长移出成员。
   *
   * - 接口：`DELETE /api/team/member/:id`
   * - 鉴权：需要访问令牌 + 队长 + 未确认参赛
   * - 文档：api-7-team.md §7.10.2
   *
   * 不能移出自己（请用转让队长或解散队伍）。
   *
   * @param {number} accountId 被移除成员的账号 id
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, removedAccountId: number }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁；`不能把自己移出队伍，请用转让或解散`
   *   - 404 `E_NOT_FOUND`：`该成员不在你的队伍里`
   *   - 409 `E_CONFLICT`：`队伍已确认参赛，该操作已锁定`
   */
  removeMember: (accountId) =>
    request(`/team/member/${accountId}`, {
      method: "DELETE",
      useAuth: true,
    }),

  /**
   * 退队（队长且无其他成员时会顺带解散）。
   *
   * - 接口：`POST /api/team/leave`
   * - 鉴权：需要访问令牌
   * - 文档：api-7-team.md §7.10.1
   *
   * 队长还有成员时不能直接退队（先转让或解散）；已确认参赛的队伍不允许退队。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, dissolved: boolean }, req_id: string }>}
   *   `dissolved: true` 表示这次退队导致队伍解散。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：`队伍已被官方封禁`
   *   - 409 `E_CONFLICT`：`你不在任何队伍里` / `队伍已确认参赛，该操作已锁定` /
   *     `你是队长，请先转让队长或解散队伍`
   */
  leaveTeam: () =>
    request("/team/leave", {
      method: "POST",
      useAuth: true,
    }),

  /**
   * 队长转让（目标必须是本队成员，且不能是自己）。
   *
   * - 接口：`POST /api/team/transfer`
   * - 鉴权：需要访问令牌 + 队长 + 未确认参赛
   * - 文档：api-7-team.md §7.10.3
   *
   * 开赛锁同样生效：确认参赛后不能换队长。
   *
   * @param {number} accountId 新队长账号 id
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, captainId: number }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 404 `E_NOT_FOUND`：`目标不是你的队伍成员`
   *   - 409 `E_CONFLICT`：`不能转让给自己` / `队伍已确认参赛，该操作已锁定`
   */
  transferCaptain: (accountId) =>
    request("/team/transfer", {
      method: "POST",
      body: { account_id: accountId },
      useAuth: true,
    }),

  /**
   * 队长解散队伍。
   *
   * - 接口：`POST /api/team/dissolve`
   * - 鉴权：需要访问令牌 + 队长
   * - 文档：api-7-team.md §7.10.4
   *
   * 已确认参赛的队伍不能自行解散（需联系官方）；解散后队伍立即不可访问、队名释放。
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   teamId: number, dissolved: true }, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：非队长，或队伍已被封禁
   *   - 409 `E_CONFLICT`：`队伍已确认参赛，无法自行解散，请联系官方`
   */
  dissolveTeam: () =>
    request("/team/dissolve", {
      method: "POST",
      useAuth: true,
    }),
};

export default teamApi;
