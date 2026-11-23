import request from "@/api/request";

/**
 * @file 队伍级 tips 接口（api-10-tips-hints.md §10.1–§10.2）。
 *
 * tips 是**队伍共享**额度：同队多人读到同一个余额，任一成员消费都会让数字变化，
 * 所以**不要把余额缓存在本地**，需要时重新拉取。
 *
 * 无队伍时后端返回 `200` + `teamId: null` + 零值，属正常空值状态
 */

/**
 * tips 计费规则。
 * @typedef {Object} TipsRule
 * @property {number} rate_per_hour 每小时自然增长点数
 * @property {number} daily_cap 每日上限
 */

/**
 * 今日累计。
 * @typedef {Object} TipsToday
 * @property {string} day_key 日期键，如 `2026-10-13`
 * @property {number} accrued 今日已累积
 * @property {number} cap 今日上限
 */

/**
 * `getBalance()` 的 `data`。
 * @typedef {Object} TipsBalance
 * @property {number|null} teamId 队伍 id（不是账号 id）；无队伍时为 `null`
 * @property {number} balance 本队共享余额；无队伍时为 `0`
 * @property {TipsRule} rule 计费规则（**没有** `hint_cost`：人工提示按每条报价）
 * @property {TipsToday|null} today 今日累计；无队伍时为 `null`
 * @property {string|null} next_accrual_at 下次自然增长时间（ISO 8601）；无队伍时为 `null`
 */

/**
 * 一条 tips 流水。
 * @typedef {Object} TipsLedgerEntry
 * @property {number} id 流水 id（翻页游标）
 * @property {number} delta 变化量（正数入账、负数扣减）
 * @property {"accrue"|"puzzle"|"milestone"|"admin"|"spend"|"hint"|"refund"} reason
 *   `accrue` 自然增长 / `puzzle` 解题奖励 / `milestone` 里程碑 / `admin` 管理端发扣 /
 *   `spend` 消费 / `hint` 提示扣费 / `refund` 罕见退款（已扣费但答复未送达时关闭请求）
 * @property {string|null} refType 业务引用类型：`hint_request` = 人工提示（`refId` 为求提示请求 id）、
 *   `pz_hint` = 预置提示（`refId` 为提示 id）；其他类型由后端定义
 * @property {number|null} refId 引用 id
 * @property {number} balanceAfter 记账后的余额
 * @property {string|null} operator 操作人（管理端发扣时有值）
 * @property {string|null} note 备注
 * @property {string} createdAt 记账时间（ISO 8601）
 */

/**
 * `getLedger()` 的 `data`。
 * @typedef {Object} TipsLedger
 * @property {number|null} teamId 队伍 id；无队伍时为 `null`
 * @property {TipsLedgerEntry[]} items 流水（`id` 倒序）；无队伍时为 `[]`
 * @property {number|null} nextCursor 下一页游标；没有更多时为 `null`
 * @property {boolean} hasMore 是否还有下一页
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

export const tipsApi = {
  /**
   * 读取本队 tips 余额与计费规则。
   *
   * - 接口：`GET /api/tips/balance`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.1
   *
   * 无队伍时返回 `200` + `teamId: null` + 零值（**不是错误**）。
   * `rule` 里已没有 `hint_cost`（统一单价废弃）：人工提示的价格来自该条请求的 `quotedCost`。
   *
   * @returns {Promise<{ ok: boolean, data: TipsBalance, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：个人封禁（队伍封禁不拦读取）
   */
  getBalance: () =>
    request("/tips/balance", {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 读取本队 tips 流水（倒序游标分页）。
   *
   * - 接口：`GET /api/tips/ledger`
   * - 鉴权：需要访问令牌
   * - 文档：api-10-tips-hints.md §10.2
   *
   * 流水是**队伍级**的：响应项没有 `accountId`，不区分具体成员。
   *
   * @param {Object} [query]
   * @param {number} [query.cursor=0] 上一页的 `nextCursor`
   * @param {number} [query.limit=20] 每页条数（1–100；服务端默认 30，本封装默认 20）
   * @returns {Promise<{ ok: boolean, data: TipsLedger, req_id: string }>}
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：`cursor` / `limit` 越界（`limit` 需在 1–100）
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：个人封禁
   */
  getLedger: ({ cursor = 0, limit = 20 } = {}) =>
    request("/tips/ledger", {
      method: "GET",
      params: { cursor, limit },
      useAuth: true,
    }),
};

export default tipsApi;
