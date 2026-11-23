import request, { setAccessToken, clearAccessToken } from "@/api/request";

/**
 * @file 认证与会话接口（`/api/auth/*`）。
 *
 * 约定：
 * - 成功返回后端统一信封 `{ ok: true, data, req_id }`；失败时 `request` 抛出 {@link ApiError}，
 *   调用方按 `error.code` / `error.status` / `error.reasonCode` / `error.payload` 分支。
 * - 请求参数与错误码以文档为准：
 *   api-3-registration.md（注册）、api-4-authentication.md（登录与会话）、
 *   api-5-username-management.md（用户名）。
 */

/**
 * 登录 / 注册成功后的账号快照。
 * @typedef {Object} AuthAccount
 * @property {number} id 账号 id
 * @property {string} player_no 玩家编号，如 `M2000001`
 * @property {string} username 用户名
 * @property {"player"|"captain"|"staff"|"admin"} role 角色
 * @property {{ id: number, name: string } | null} team 所属队伍；未加入队伍为 `null`
 * @property {string[]} [permissions] 权限码清单；登录与刷新下发，`player` / `captain` 为 `[]`
 * @property {1|2|3|4} [status] 账号状态：1 注销、2 正常、3 禁言、4 封禁
 * @property {boolean} [banned] 封禁标记，与 `status=4` 同义（含所在队伍被封禁）
 */

/**
 * 人机验证信封：把验证组件产出的凭据放进 `response` 原样回传，
 * 不要按 provider 改名、拼接、裁剪或转码。
 * @typedef {Object} CaptchaEnvelope
 * @property {string} response 验证组件产出的凭据
 */

/**
 * 登录 / 注册即登录 / 刷新令牌的公共数据体。
 * @typedef {Object} AuthSessionData
 * @property {string} access_token 访问令牌（2 小时），已由封装写入本地存储
 * @property {number} expires_in 访问令牌有效期（秒，通常 7200）
 * @property {AuthAccount} account 账号快照
 */

/**
 * 注册页公开配置。
 * @typedef {Object} RegistrationConfig
 * @property {Object} captcha 人机验证配置
 * @property {string} captcha.mode 仅供展示与排障，前端**不得**据此分支
 * @property {boolean} captcha.enabled `false` 时不渲染验证组件
 * @property {boolean} captcha.ready `false` 时不要渲染组件，只提示暂不可注册
 * @property {string} [captcha.script] 组件脚本地址，由后端下发，不要写死
 * @property {{ driver: string, params: Object } | null} [captcha.widget] 前端只认这个对象，`params` 原样转交
 * @property {string} [captcha.site_key] 兼容期根级字段
 * @property {string[]} [captcha.test_hosts] 需要 `dev_ticket` 的测试域名
 * @property {boolean} [captcha.test_ticket_required] 测试域名是否必须带 `dev_ticket`
 * @property {number} code_length 验证码位数
 * @property {number} code_ttl_minutes 验证码有效期（分钟）
 * @property {number} resend_cooldown_sec 重新发送冷却（秒）
 * @property {number} password_min_length 密码最小长度
 * @property {number} password_max_length 密码最大长度
 */

/**
 * 验证码邮件下发结果。
 * @typedef {Object} VerificationCodeData
 * @property {boolean} sent 是否已发出
 * @property {string} email 脱敏后的收件地址，如 `qq***@outlook.com`
 * @property {number} ttl_minutes 有效期（分钟）
 * @property {string} expires_at 过期时间
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

export const authApi = {
  /**
   * 获取注册页公开配置（人机验证驱动、验证码与密码长度 / 冷却）。
   *
   * - 接口：`GET /api/auth/reg/config`
   * - 鉴权：无
   * - 文档：api-3-registration.md §3.1
   *
   * @returns {Promise<{ ok: boolean, data: RegistrationConfig, req_id: string }>}
   *   `captcha.ready=false` 时不要渲染验证组件，只提示「暂不可用」；
   *   组件只认 `captcha.widget`（`driver` + 不透明 `params`），不要按 `captcha.mode` 分支。
   */
  getRegistrationConfig: () =>
    request("/auth/reg/config", {
      method: "GET",
      skipRefresh: true,
    }),

  /**
   * 用户登录。
   *
   * - 接口：`POST /api/auth/login`
   * - 鉴权：无
   * - 文档：api-4-authentication.md §4.1
   *
   * @param {Object} payload 登录凭据
   * @param {"email"|"username"} payload.type 标识类型，决定 `identifier` 的解析方式
   * @param {string} payload.identifier 登录标识，大小写不敏感：
   *   `type=email` 传邮箱，`type=username` 传用户名（目前弃用使用用户ID登录）
   * @param {string} payload.password 密码
   * @returns {Promise<{ ok: boolean, data: AuthSessionData, req_id: string }>}
   *   成功后 `access_token` 已写入本地；调用方通常只需读 `data.account`。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：登录参数校验失败
   *     detail.fields：
   *       `type` -- 缺失或取值不支持
   *       `identifier` -- 缺失或与 `type` 不匹配
   *   - 401 `E_AUTH`：账号或密码错误（统一文案，不透露账号是否存在）
   *   - 429 `E_QUOTA`：连续失败 5 次后锁定 15 分钟，按 `detail.retry_after_sec` 倒计时
   *
   * 封禁账号密码正确时**仍然成功**（`account.status=4`、`account.banned=true`），
   * 但令牌只能调 `/me/*` 申诉接口，其余接口一律 403 `E_BANNED`。
   */
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

  /**
   * 检查用户名是否可用。
   *
   * - 接口：`POST /api/auth/username-available`
   * - 鉴权：无（登录后调用可返回 `unchanged`，即当前账号正在使用该名字）
   * - 文档：api-5-username-management.md §五
   *
   * 仅作提前提示：通过后仍可能被并发抢注，最终判定在注册 `verifyVerificationCode()` 或改名接口。
   *
   * @param {string} username 待检查的用户名（1–32 个 Unicode 码点；
   *   禁止 `@`、路径分隔符、不可见字符、emoji、`M2` + 6 位数字）
   * @returns {Promise<{ ok: boolean, data: {
   *   status: "available"|"taken"|"unchanged", username: string }, req_id: string }>}
   *   data.status -- `available` 允许提交 / `taken` 提示更换 / `unchanged` 无需更改（仅登录后）
   *   data.username -- 已去除首尾空白并执行 NFC 归一化
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：用户名不合规
   *     detail.fields：
   *       `username`：`必填` -- 缺失 / 空串 / 纯空白
   *       `username`：`长度最多 32` -- 超过 32 个码点（可能显示为「用户名最多 32 个字符」）
   *       `username`：`用户名不能包含 @` -- 含 `@`
   *       `username`：`用户名不能包含不可见字符、组合音标或符号（U+xxxx）` -- 含不可见字符、组合音标或 emoji
   *       `username`：`用户名不能包含空格以外的空白、控制字符或方括号以外的符号` -- 含控制字符、全角空白等
   *       `username`：`用户名不能采用 M2+6位数字 的编号格式` -- 形如 `M2000001`
   *   文案会本地化：按字段键 + 状态码分支，不要匹配文案。
   *
   * 限流：每秒 20 次；每账号或 IP 每天 200 次。
   */
  usernameAvailable: (username) =>
    request("/auth/username-available", {
      method: "POST",
      body: { username },
      skipRefresh: true,
    }),

  /**
   * 发送注册验证码邮件（**只发第一次**）。
   *
   * - 接口：`POST /api/auth/reg/start`
   * - 鉴权：无
   * - 文档：api-3-registration.md §3.2
   *
   * 本接口只提交邮箱：`username` / `password` 在第二步（`verifyVerificationCode`）提交，
   * 传到这里会被静默忽略；同一邮箱第二次发码会得到 429 `REG_VERIFY_PENDING`，
   * 应改走 `resendVerificationCode()`。
   *
   * @param {Object} payload
   * @param {string} payload.email 注册邮箱（≤128 字符，需能收信）
   * @param {CaptchaEnvelope} [payload.captcha] `captcha.enabled=true` 时必填
   * @param {string} [payload.dev_ticket] 测试域名需要，见 `reg/config` 的 `test_hosts` / `test_ticket_required`
   * @returns {Promise<{ ok: boolean, data: VerificationCodeData, req_id: string }>}
   *   成功状态码为 201，`data.email` 为脱敏地址。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：注册参数校验失败
   *     detail.fields：
   *       `email`：`必填` -- 缺失 / 空串 / 纯空白
   *       `email`：`长度最多 128` -- 超过 128 字符
   *       `email`：`邮箱格式不正确` -- 语法非法
   *       `email`：`该邮箱域名不存在或无法接收邮件，请检查后重试` -- 域名收不到信
   *   - 403 `E_FORBIDDEN`：人机验证失败
   *     detail.reason_code：
   *       `CAPTCHA_MISSING` -- 未提交凭据；提示先完成人机验证并高亮组件
   *       `CAPTCHA_INVALID` -- 凭据已用 / 过期 / 无效；重置组件后重试
   *       `CAPTCHA_TEST_TICKET_REQUIRED` -- 测试域名缺 `dev_ticket`；提示补凭证
   *       `CAPTCHA_HOST_MISMATCH` -- 票的 hostname 与站点不符；提示联系管理员并重置组件
   *       `CAPTCHA_UNAVAILABLE` -- 校验服务网络异常 / 超时；提示稍后重试，不要自动重试
   *       `CAPTCHA_MISCONFIGURED` -- 服务端人机验证异常；提示稍后重试，可上报监控
   *       `CAPTCHA_NOT_READY` -- 人机验证未就绪；提示注册暂不可用
   *   - 409 `E_CONFLICT`：邮箱已注册（`detail.player_no` 可用于引导登录 / 找回）
   *   - 429 `E_QUOTA`：发送过于频繁
   *     detail.reason_code：
   *       `REG_VERIFY_PENDING` -- 该邮箱已有未消费验证码；改调 `resendVerificationCode()` 并按 `detail.resend_after_sec` 倒计时
   *       `空` -- 每日额度用尽（每 IP 10 封，与重发共用）；按 `detail.retry_after_sec` 等待
   */
  sendVerificationCode: (payload) =>
    request("/auth/reg/start", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  /**
   * 重新发送注册验证码（作废旧码，有效期从这一刻重新计时）。
   *
   * - 接口：`POST /api/auth/reg/resend`
   * - 鉴权：无
   * - 文档：api-3-registration.md §3.3
   *
   * 请求体与发送接口相同，但**不带** `platform` / `platform_uid`：它们是第一步登记的
   * 注册来源，重发时由服务端沿用。
   *
   * @param {Object} payload
   * @param {string} payload.email 必须与 `sendVerificationCode()` 提交的是同一个邮箱
   * @param {CaptchaEnvelope} [payload.captcha] `captcha.enabled=true` 时必填，与发送接口同一套人机验证
   * @param {string} [payload.dev_ticket] 测试域名需要
   * @returns {Promise<{ ok: boolean, data: VerificationCodeData, req_id: string }>}
   *   与发送接口同形状（201），可复用同一段解析与提示。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：注册参数校验失败
   *     detail.fields：
   *       `email`：`必填` -- 缺失 / 空串 / 纯空白
   *       `email`：`长度最多 128` -- 超过 128 字符
   *       `email`：`邮箱格式不正确` -- 语法非法
   *       `email`：`该邮箱域名不存在或无法接收邮件，请检查后重试` -- 域名收不到信
   *   - 403 `E_FORBIDDEN`：人机验证失败
   *     detail.reason_code：
   *       `CAPTCHA_MISSING` -- 未提交凭据；提示先完成人机验证并高亮组件
   *       `CAPTCHA_INVALID` -- 凭据已用 / 过期 / 无效；重置组件后重试
   *       `CAPTCHA_TEST_TICKET_REQUIRED` -- 测试域名缺 `dev_ticket`；提示补凭证
   *       `CAPTCHA_HOST_MISMATCH` -- 票的 hostname 与站点不符；提示联系管理员并重置组件
   *       `CAPTCHA_UNAVAILABLE` -- 校验服务网络异常 / 超时；提示稍后重试，不要自动重试
   *       `CAPTCHA_MISCONFIGURED` -- 服务端人机验证异常；提示稍后重试，可上报监控
   *       `CAPTCHA_NOT_READY` -- 人机验证未就绪；提示注册暂不可用
   *   - 409 `E_CONFLICT`：该邮箱没有进行中的注册验证（退回第一步重新开始），或已注册成功
   *   - 429 `E_QUOTA`：同邮箱 60 秒冷却（`detail.retry_after_sec`），或每 IP 每日额度用尽
   */
  resendVerificationCode: (payload) =>
    request("/auth/reg/resend", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  /**
   * 校验验证码并完成注册（注册即登录）。
   *
   * - 接口：`POST /api/auth/reg/verify`
   * - 鉴权：无
   * - 文档：api-3-registration.md §3.4
   *
   * @param {Object} payload
   * @param {string} payload.email 与第一步提交的**同一个**邮箱（服务端不改写、也不猜）
   * @param {string} payload.code 邮件中的验证码（位数见 `reg/config.code_length`）
   * @param {string} payload.username 用户名，规则见 `usernameAvailable()`
   * @param {string} [payload.password] 自设密码（8–128 位，不 trim；空串 / 纯空白等同不填）。
   *   不填则由系统生成初始密码并发邮件
   * @returns {Promise<{ ok: boolean, data: AuthSessionData & {
   *   initial_password_mailed?: boolean, initial_password?: string }, req_id: string }>}
   *   data.access_token -- 已写入本地，无需再调登录接口
   *   data.account -- 新账号快照（形状同登录响应）
   *   data.initial_password_mailed -- `true` = 系统生成的初始密码已发到注册邮箱；自设密码时不出现
   *   data.initial_password -- 仅在初始密码**发送失败**时回传，须显著展示并要求立刻改密
   *   密码交付分支：自设密码 → 两个字段都不存在；未设密码且邮件已发 → 只有
   *   `initial_password_mailed: true`；未设密码且邮件未投递 → `initial_password_mailed: false`
   *   且回传 `initial_password`。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：注册参数校验失败（每字段只给第一条原因）
   *     detail.fields：
   *       `email`：`必填` -- 缺失 / 空串 / 纯空白
   *       `email`：`长度最多 128` -- 超过 128 字符
   *       `email`：`邮箱格式不正确` -- 语法非法
   *       `email`：`该邮箱域名不存在或无法接收邮件，请检查后重试` -- 域名收不到信
   *       `code`：`必填` -- 缺失 / 空串 / 纯空白
   *       `code`：`长度最多 8` -- 超过 8 字符
   *       `code`：`应为 6 位数字` -- 形如 `12ab` / `1234`
   *       `username`：`必填` -- 缺失 / 空串 / 纯空白
   *       `username`：`长度最多 32` -- 超过 32 个码点
   *       `username`：`用户名不能包含 @` -- 含 `@`
   *       `username`：`用户名不能包含不可见字符、组合音标或符号（U+xxxx）` -- 含不可见字符、组合音标或 emoji
   *       `username`：`用户名不能包含空格以外的空白、控制字符或方括号以外的符号` -- 含控制字符、全角空白等
   *       `username`：`用户名不能采用 M2+6位数字 的编号格式` -- 形如 `M2000001`
   *       `password`：`长度至少 8` -- 提交了值但不足 8 位
   *       `password`：`长度最多 128` -- 提交了值但超过 128 位（不传 / 空串时不会出现该键）
   *   - 400 `E_CODE`：验证码无效、过期或错误（`detail.attempts_left` 为剩余次数，单码最多 5 次）
   *   - 409 `E_CONFLICT`：用户名已被占用
   *     detail.username：
   *       `true` -- 验证码不会被消费，改名后可用同一张码重试，不必重新收码
   */
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

  /**
   * 修改当前账号密码。
   *
   * - 接口：`POST /api/auth/password`
   * - 鉴权：需要访问令牌
   * - 文档：api-4-authentication.md §4.4
   *
   * @param {Object} payload
   * @param {string} payload.old_password 原密码
   * @param {string} payload.new_password 新密码（≥8 位，上限见 `reg/config.password_max_length`）
   * @returns {Promise<{ ok: boolean, data: {
   *   changed: true, tokenVersion: number }, req_id: string }>}
   *   data.changed -- 恒为 `true`
   *   data.tokenVersion -- 递增后的令牌版本；该账号所有旧 access token 已失效
   *   成功后**全部会话失效**且刷新 Cookie 被清除，调用方应引导用户重新登录。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：新密码不合规（≥8 位，上限见 `reg/config.password_max_length`）
   *   - 401 `E_AUTH`：原密码不正确
   */
  changePassword: (payload) =>
    request("/auth/password", {
      method: "POST",
      body: payload,
      useAuth: true,
    }),

  /**
   * 修改当前账号用户名。
   *
   * - 接口：`POST /api/auth/username`
   * - 鉴权：需要访问令牌
   * - 文档：api-5-username-management.md §六
   *
   * 修改前可先调 `usernameAvailable()` 做建议性检查，最终判定在本接口。
   *
   * @param {Object} payload
   * @param {string} payload.username 新用户名（规则见 `usernameAvailable()`）
   * @returns {Promise<{ ok: boolean, data: {
   *   changed: boolean,
   *   account: { id: number, playerNo: string, username: string,
   *              previousUsername: string, role: string, status: number }
   * }, req_id: string }>}
   *   data.changed -- 是否真的发生了变更
   *   data.account.id -- 账号 id
   *   data.account.playerNo -- 玩家编号
   *   data.account.username -- 新用户名（已执行 NFC 归一化）
   *   data.account.previousUsername -- 变更前的用户名
   *   data.account.role -- 角色
   *   data.account.status -- 账号状态（2 正常 / 3 禁言 / 4 封禁）
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：用户名不合规
   *     detail.fields：
   *       `username`：`必填` -- 缺失 / 空串 / 纯空白
   *       `username`：`长度最多 32` -- 超过 32 个码点
   *       `username`：`用户名不能包含 @` -- 含 `@`
   *       `username`：`用户名不能包含不可见字符、组合音标或符号（U+xxxx）` -- 含不可见字符、组合音标或 emoji
   *       `username`：`用户名不能包含空格以外的空白、控制字符或方括号以外的符号` -- 含控制字符、全角空白等
   *       `username`：`用户名不能采用 M2+6位数字 的编号格式` -- 形如 `M2000001`
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：封禁账号不允许改名
   *   - 409 `E_CONFLICT`：用户名已被占用（含仅改大小写被他人占用的情况）
   */
  changeUsername: (payload) =>
    request("/auth/username", {
      method: "POST",
      body: payload,
      useAuth: true,
    }),

  /**
   * 找回密码第一步：发送重置邮件。
   *
   * - 接口：`POST /api/auth/forgot`
   * - 鉴权：无
   * - 文档：api-4-authentication.md §4.5
   *
   * @param {Object} payload
   * @param {"email"|"username"} payload.type 标识类型
   * @param {string} payload.identifier 邮箱或用户名
   * @param {CaptchaEnvelope} payload.captcha 人机验证凭据（必填）
   * @param {string} [payload.dev_ticket] 测试域名需要
   * @returns {Promise<{ ok: boolean, data: {
   *   accepted: boolean, delivered: boolean, message: string }, req_id: string }>}
   *   data.accepted -- 请求已被受理（恒为 `true`，与账号是否存在无关）
   *   data.delivered -- 是否确认已投递；`false` 不代表账号不存在（邮件异步发送）
   *   data.message -- 固定提示「若该账号存在，我们已发送重置邮件」，可直接展示
   *   响应恒定，不透露账号是否存在。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：参数校验失败（`detail.fields` 给具体字段原因）
   *   - 403 `E_FORBIDDEN`：人机验证失败
   *     detail.reason_code：
   *       `CAPTCHA_MISSING` -- 未提交凭据；提示先完成人机验证并高亮组件
   *       `CAPTCHA_INVALID` -- 凭据已用 / 过期 / 无效；重置组件后重试
   *       `CAPTCHA_TEST_TICKET_REQUIRED` -- 测试域名缺 `dev_ticket`；提示补凭证
   *       `CAPTCHA_HOST_MISMATCH` -- 票的 hostname 与站点不符；提示联系管理员并重置组件
   *       `CAPTCHA_UNAVAILABLE` -- 校验服务网络异常 / 超时；提示稍后重试，不要自动重试
   *       `CAPTCHA_MISCONFIGURED` -- 服务端人机验证异常；提示稍后重试，可上报监控
   *       `CAPTCHA_NOT_READY` -- 人机验证未就绪；提示注册暂不可用
   *   - 429 `E_QUOTA`：每个 IP 每天最多 3 次
   */
  forgotPassword: (payload) =>
    request("/auth/forgot", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  /**
   * 找回密码第二步：用邮件中的 token 重置密码。
   *
   * - 接口：`POST /api/auth/reset`
   * - 鉴权：无
   * - 文档：api-4-authentication.md §4.5
   *
   * @param {Object} payload
   * @param {string} payload.token 邮件中的重置令牌
   * @param {string} payload.new_password 新密码
   * @returns {Promise<{ ok: boolean, data: { reset: true }, req_id: string }>}
   *   data.reset -- 恒为 `true`
   *   成功后该账号的其他会话失效。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：密码不合规
   *   - 401 `E_AUTH`：令牌无效或已使用
   */
  resetPassword: (payload) =>
    request("/auth/reset", {
      method: "POST",
      body: payload,
      skipRefresh: true,
    }),

  /**
   * 刷新访问令牌。
   *
   * - 接口：`POST /api/auth/refresh`
   * - 认证：`mistarg_rt` Cookie（也可在请求体传 `{ refresh_token }`，本封装不使用）
   * - 文档：api-4-authentication.md §4.2
   *
   * 每次刷新都会轮换令牌，**不要并发调用**：`request` 内部处理 401 重试时已复用同一次结果。
   *
   * @returns {Promise<{ ok: boolean, data: AuthSessionData, req_id: string }>}
   *   新令牌已写入本地，`data.account.permissions` 为最新权限快照。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：无有效刷新令牌（Cookie 缺失、过期或畸形）
   */
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

  /**
   * 初始化会话（免密登录）：用刷新 Cookie 换取访问令牌与账号快照。
   *
   * 内部走 `refresh()`，差异是把异常收成结果对象，便于应用启动时判断登录态。
   *
   * @returns {Promise<
   *   { ok: true, account: AuthAccount|null, accessToken: string, expiresIn: number } |
   *   { ok: false, account: null, accessToken: "", expiresIn: 0, error: unknown }
   * >} 失败时已清除本地访问令牌。
   * 
   * 注：本质本函数并非后端接口，而是对 `refresh()` 的封装。由于功能统一就放在这里了
   * 
   */
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

  /**
   * 注销当前会话。
   *
   * - 接口：`POST /api/auth/logout`
   * - 认证：`mistarg_rt` Cookie（幂等：没带令牌也返回 200）
   * - 文档：api-4-authentication.md §4.3
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   loggedOut: true, revoked: boolean }, req_id: string }>}
   *   data.loggedOut -- 恒为 `true`（幂等：没带有效刷新令牌也返回成功）
   *   data.revoked -- 是否真的撤销了一条刷新令牌；幂等分支下可能为 `false`
   *   无论请求成败都会清除本地访问令牌（`finally`）。
   */
  logout: () =>
    request("/auth/logout", {
      method: "POST",
      useAuth: true,
      skipRefresh: true,
    }).finally(() => {
      clearAccessToken();
    }),

  /**
   * 注销该账号的全部会话（所有访问令牌立即失效）。
   *
   * - 接口：`POST /api/auth/logout-all`
   * - 鉴权：需要访问令牌
   * - 文档：api-4-authentication.md §4.3
   *
   * @returns {Promise<{ ok: boolean, data: {
   *   loggedOutAll: true, tokenVersion: number, revoked: number }, req_id: string }>}
   *   data.loggedOutAll -- 恒为 `true`
   *   data.tokenVersion -- 递增后的令牌版本；该账号所有旧 access token 立即失效
   *   data.revoked -- 被删除的刷新令牌行数（≈ 已登录设备数）
   *   无论请求成败都会清除本地访问令牌（`finally`）。
   */
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
