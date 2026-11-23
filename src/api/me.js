import request from "@/api/request";

/**
 * @file 账号处罚状态与申诉（`/api/me/*`，api-11-moderation-mute.md）。
 *
 * 这三条接口是**封禁账号唯一还能用**的接口族：个人封禁 / 队伍封禁期间，其余接口一律
 * 403 `E_BANNED`，但这里仍然放行；因此统一 `useAuth: true`（走正常的刷新令牌链路）。
 *
 * - 成功返回后端统一信封 `{ ok: true, data, req_id }`；失败时 `request` 抛出 {@link ApiError}，
 *   调用方按 `error.status` / `error.code` / `error.reasonCode` / `error.payload` 分支。
 */

/**
 * 申诉额度与状态块；账号级（`appeal`）与队伍级（`teamAppeal`）同形。
 * @typedef {Object} AppealSummary
 * @property {"account"|"team"} [scope] 申诉主体；`/me/status` 的个人块不带该字段
 * @property {"ban"|"mute"|null} kind 处罚种类；`null` = 没有需要申诉的处罚
 * @property {number} [teamId] 队伍 id；仅队伍块
 * @property {string} [teamName] 队伍名；仅队伍块
 * @property {number} limit 额度上限（每类 3 条）
 * @property {number} used 已用条数
 * @property {number} remaining 剩余条数
 * @property {"none"|"can_submit"|"awaiting_reply"|"closed"} state 申诉状态机；
 *   `closed` = 3 条用尽且官方已回复、处罚仍在
 * @property {boolean} can_submit 当前是否可提交（状态可提交 && 本人有资格）
 * @property {string|null} last_submitted_at 最近一次提交时间（ISO 8601）
 * @property {{ mail_id: number, subject: string, content: string, created_at: string }|null} last_reply
 *   最近一条官方回复；尚未回复时为 `null`
 */

/**
 * 申诉链里的一封邮件。
 * @typedef {Object} AppealMail
 * @property {number} id 邮件 id（链按 `id` 升序、不分页）
 * @property {string} subject 主题（由服务端按 `kind` 生成）
 * @property {string} content 正文
 * @property {"me"|"official"} from 发送方
 * @property {number|null} reply_to 回复的目标邮件 id；链首为 `null`
 * @property {string} created_at 创建时间（ISO 8601）
 * @property {AppealAttachment[]} attachments 附件；没有时为空数组
 */

/**
 * 申诉附件（读取时的形状）。
 * @typedef {Object} AppealAttachment
 * @property {number} id 附件 id
 * @property {string} fileName 文件名
 * @property {string} mimeType MIME 类型 (Multipurpose Internet Mail Extensions)
 * @property {number} size 字节数
 * @property {string} url 受保护路径 `/api/msg/media/<id>`，需带访问令牌取字节；
 *   封禁态也可取申诉邮件里的图
 */

/**
 * `GET /api/me/status` 的 `data`。
 * @typedef {Object} ModerationStatus
 * @property {1|2|3|4} status **等效门禁状态** = `max(个人, 队伍)`：2 正常 / 3 禁言 / 4 封禁；
 *   1（注销）按账号不存在处理
 * @property {boolean} banned `status === 4`（含队伍封禁），前端分支用它即可
 * @property {string|null} ban_reason 个人封禁优先，否则取队伍封禁原因；`null` = 无 / 永久
 * @property {string|null} ban_until 封禁到期时间（ISO 8601）；`null` = 永久 / 无
 * @property {string|null} mute_reason 本人**账号级**禁言原因；队伍禁言原因见 `team.reason`
 * @property {string|null} mute_until 本人账号级禁言到期时间
 * @property {boolean} muted 本人 `status=3` **或**所在队伍禁言时为 `true`
 * @property {{ teamId: number, teamName: string, status: 1|2|3|4, reason: string|null,
 *   until: string|null, muted: boolean }|null} team 所在队伍及其处罚；无队伍为 `null`
 * @property {{ id: number, player_no: string, username: string, role: string }} account 账号快照
 * @property {AppealSummary} appeal 个人处罚的申诉块（`kind` 由个人状态推导）
 * @property {AppealSummary|null} teamAppeal 队伍申诉块；队伍处罚生效期间全体在任成员都有值，
 *   否则为 `null`
 */

/**
 * `GET /api/me/appeal` 的 `data`。
 * @typedef {Object} AppealChain
 * @property {"account"|"team"} scope 申诉主体
 * @property {"ban"|"mute"|null} kind 处罚种类；`null` = 没有可申诉的处罚（`mails` 为空）
 * @property {number} [teamId] 队伍 id；仅 `scope=team`
 * @property {AppealSummary|null} appeal 申诉额度与状态；没有可申诉处罚时为 `null`
 * @property {AppealMail[]} mails 申诉链邮件，按 `id` 升序、不分页
 */

/**
 * `POST /api/me/appeal` 成功的 `data`（201）。
 * @typedef {Object} AppealSubmitResult
 * @property {number} mailId 新建邮件的 id
 * @property {string} createdAt 创建时间（ISO 8601）
 * @property {number} used 该主体提交后的已用额度
 * @property {"account"|"team"} [scope] 申诉主体；仅 `scope=team` 的响应带
 * @property {"ban"|"mute"} kind 处罚种类（服务端判定）
 * @property {number} [teamId] 队伍 id；仅 `scope=team` 的响应带
 * @property {string} subject 服务端生成的主题
 * @property {AppealAttachment[]} attachments 本条申诉实际写入的附件；没带时为 `[]`
 * @property {AppealSummary} appeal 提交后的申诉额度与状态（`awaiting_reply`）
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

export const meApi = {
  /**
   * 读取账号 / 队伍处罚状态与两级申诉摘要（轮询用，建议 30–60s）。
   *
   * - 接口：`GET /api/me/status`
   * - 鉴权：需要访问令牌；封禁（个人 / 队伍）期间仍可用
   * - 文档：api-11-moderation-mute.md §三
   *
   * 判断「被封禁 / 被禁言」只看 `status` 与 `banned` / `muted`（等效状态，已把队伍处罚算进来）；
   * 个人与队伍的处罚细节分别在 `appeal` 与 `teamAppeal` 块里。
   *
   * @returns {Promise<{ ok: boolean, data: ModerationStatus, req_id: string }>}
   *   无处罚时：`status: 2`、`banned: false`、四个处罚字段为 `null`、`muted: false`、
   *   `appeal.kind: null`、`teamAppeal: null`。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   */
  getStatus: () =>
    request("/me/status", {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 读取申诉链与申诉额度（`scope` 决定申诉主体）。
   *
   * - 接口：`GET /api/me/appeal`
   * - 鉴权：需要访问令牌；封禁期间仍可用
   * - 文档：api-11-moderation-mute.md §三
   *
   * `scope=account`（默认）：本人账号级处罚；`team`：队伍处罚的**队伍申诉**。
   * 队伍处罚（禁言 3 / 封禁 4）生效期间全体在任成员都可读；无队伍处罚时非队长 403、
   * 队长返回空链。
   *
   * @param {"account"|"team"} [scope="account"] 申诉主体
   * @returns {Promise<{ ok: boolean, data: AppealChain, req_id: string }>}
   *   没有可申诉处罚时 `kind: null` + `mails: []`（不报错）。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_FORBIDDEN`：`scope=team` 但本人无资格；仅「无队伍处罚」时出现，
   *     文案为 `你不在这支队伍里` / `只有队长可以查看队伍申诉`（可能本地化，按 `error.status` 分支）
   */
  getAppeal: (scope = "account") =>
    request("/me/appeal", {
      method: "GET",
      params: { scope },
      useAuth: true,
    }),

  /**
   * 提交一条申诉。
   *
   * - 接口：`POST /api/me/appeal`
   * - 鉴权：需要访问令牌；封禁期间仍可用
   * - 文档：api-11-moderation-mute.md §三
   *
   * 提交成功后该主体进入`awaiting_reply`，官方回复前不能再提交（队伍申诉整队共享一条在途）。
   *
   * @param {Object} payload
   * @param {string} payload.content 申诉正文（1–2000 字）
   * @param {"account"|"team"} [payload.scope="account"] 申诉主体；`team` 仅队伍处罚生效期间、
   *   且有资格的成员可用
   * @param {Object[]} [payload.attachments] 申诉截图，≤3 张；元素为
   *   `{ objectKey, filename, mime, sizeBytes }`，`objectKey` 需先调 `POST /api/msg/media/sign` 获取
   * @returns {Promise<{ ok: boolean, data: AppealSubmitResult, req_id: string }>}
   *   成功状态码为 201。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：参数校验失败
   *     detail.fields：
   *       `content` -- 缺失 / 空串 / 超过 2000 字
   *       `scope` -- 不是 `account` 或 `team`
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `MSG_IMAGE_DISABLED`：附件功能未开启却带了附件
   *     （`GET /api/msg/policy.attachmentsEnabled=false`）
   *   - 403 `E_FORBIDDEN`：`scope=team` 但本人无资格（`队伍申诉需由队长提交` / `你不在这支队伍里`）
   *   - 409 `E_CONFLICT`：没有可申诉的处罚 / 已有在途申诉 / 额度已用尽（3/3）
   *     detail.reason_code：
   *       `TEAM_MUTED_CONTACT_CAPTAIN` -- 队伍禁言中且本人非队长；引导联系队长提交队伍申诉
   *       `TEAM_MUTED_USE_TEAM_APPEAL` -- 队伍禁言中且本人是队长（含队伍申诉在途 / 额度用尽）；
   *                                      引导改走队伍申诉
   *       `TEAM_BANNED_CONTACT_CAPTAIN` -- 队伍封禁中且本人非队长；引导联系队长提交队伍申诉
   *       `TEAM_BANNED_USE_TEAM_APPEAL` -- 队伍封禁中且本人是队长（含队伍申诉在途 / 额度用尽）；
   *                                       引导改走队伍申诉
   *       `TEAM_MUTED_ALL_BANNED`、`TEAM_BANNED_ALL_BANNED` -- 全队都被个人封禁，无人可提队伍申诉
   *     其余 409 **不带** `reason_code`（`当前账号没有需要申诉的处罚` / `当前队伍没有需要申诉的处罚` /
   *     `已有一条申诉正在等待官方反馈` / `申诉次数已用尽（3/3）`），按 `error.message` 展示。
   *   - 429 `E_QUOTA`：提交过于频繁（防连点）
   */
  submitAppeal: ({ content, scope = "account", attachments }) =>
    request("/me/appeal", {
      method: "POST",
      body: {
        content,
        scope,
        ...(attachments?.length ? { attachments } : {}),
      },
      useAuth: true,
    }),
};

export default meApi;
