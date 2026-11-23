import request from "@/api/request";

/**
 * @file 线索栏快照接口（`/api/me/clue-board`）。
 *
 * 只存线索栏自身的状态（板面卡片 + 移除墓碑）；标题 / 封面仍由 `GET /api/puzzle/map` 提供。
 *
 */

/**
 * 一条线索行（含墓碑）。
 * @typedef {Object} ClueBoardItem
 * @property {string} clue_id 线索 id（= 题目 key），1–64
 * @property {number|null} x 板面横坐标（像素，非负整数）；墓碑行为 `null`
 * @property {number|null} y 板面纵坐标（像素，非负整数）；墓碑行为 `null`
 * @property {boolean} removed `true` = 已从线索栏移除（墓碑）
 * @property {string} updated_at 最后一次内容变化的服务端接收时间（ISO 8601）
 * @property {string} device 最后一次内容变化的上传设备标识
 */

/**
 * 线索栏全量快照；`getSnapshot()` 与 `putSnapshot()` 的 `data` 同形状。
 * @typedef {Object} ClueBoardSnapshot
 * @property {ClueBoardItem[]} items 本账号全部线索行，按 `clue_id` 升序，含墓碑
 * @property {string|null} synced_at `items[].updated_at` 的最大值；没有任何行时为 `null`
 */

/**
 * 待上传的一条改动。
 * @typedef {Object} ClueBoardChange
 * @property {string} clue_id 线索 id（trim 后匹配 `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`）
 * @property {boolean} [removed] 默认 `false`；`true` = 移除该线索（坐标被忽略）
 * @property {number} [x] 板面横坐标（像素）；`removed=false` 时必填，0–100000 的整数
 * @property {number} [y] 板面纵坐标（像素）；`removed=false` 时必填，0–100000 的整数
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

export const clueBoardApi = {
  /**
   * 读取本账号的线索栏全量快照（含墓碑）。
   *
   * - 接口：`GET /api/me/clue-board`
   * - 鉴权：需要访问令牌；无请求体、无查询参数，不限流
   * - 文档：api-13-clue-board.md §一
   *
   * @returns {Promise<{ ok: boolean, data: ClueBoardSnapshot, req_id: string }>}
   *   新账号 / 从未上传过时 `items: []`、`synced_at: null`。
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   */
  getSnapshot: () =>
    request("/me/clue-board", {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 上传本机差异，返回合并后的服务端全量快照（形状与 `getSnapshot()` 一致）。
   *
   * - 接口：`POST /api/me/clue-board`
   * - 鉴权：需要访问令牌；同账号 5 分钟一次
   * - 文档：api-13-clue-board.md §二、§三、§五
   *
   * @param {Object} payload
   * @param {string} payload.device 本次上传的设备来源（如 `web-chrome-win`），
   *   trim 后 1–64 字符，不含控制字符；同一设备应保持稳定，便于用户辨认「谁改的」
   * @param {ClueBoardChange[]} payload.items 待同步改动，≤500 项；可传空数组表示本机没有改动
   * @returns {Promise<{ ok: boolean, data: ClueBoardSnapshot, req_id: string }>}
   *   可直接用响应覆盖本地「已知服务端快照」，`data.synced_at` 为本次接收时刻。
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：参数校验失败，本次不做任何写入
   *     detail.fields：
   *       `device` -- 缺失 / trim 后不在 1–64 字符 / 含控制字符
   *       `items` -- 非数组 / 超过 500 项
   *       `items[i].clue_id` -- 缺失 / 不匹配 `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$` / 同一请求内重复
   *       `items[i].x`、`items[i].y` -- `removed=false` 时缺失或不是 `0–100000` 的整数（如 `必须是 0–100000 的整数`）
   *       `items[i].removed` -- 不是布尔值
   *     该账号线索条目将超过 1000 条时同样返回 400，但原因不在 `fields` 内
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：账号或所在队伍被封禁
   *   - 429 `E_QUOTA`：5 分钟内重复上传（本次不做任何写入）
   *     detail.retry_after_sec：
   *       `秒数` -- 距可再次上传的时间（同响应头 `Retry-After`）；按其顺延冷却，本地改动继续保留
   */
  putSnapshot: ({ device, items }) =>
    request("/me/clue-board", {
      method: "POST",
      useAuth: true,
      body: { device, items },
    }),
};

export default clueBoardApi;
