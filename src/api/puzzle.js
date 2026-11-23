import request from "@/api/request";

/**
 * @file 题目模块（api-12-puzzle.md）：题目结构、单题视图、可塑区 RPC / 状态、
 * 预置提示购买、提交历史与答案提交。
 *
 * 所有接口都走「登录 + 取题门禁」（未登录 / 无队伍 / 队伍未确认参赛 / 未开赛），
 * 门禁与进度解锁全部由后端判定，前端只按错误码分支：
 * - `401 E_AUTH`：未登录或令牌失效
 * - `409 E_CONFLICT`：`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`
 * - `403 E_BANNED`：队伍被封禁（`detail.reason` / `detail.until`）；队伍禁言不影响取题
 * - `404 E_NOT_FOUND`：题目不存在 / 停用 / **尚未解锁**（同形，防枚举）
 *
 * 成功返回统一信封 `{ ok: true, data, req_id }`；失败时 `request` 抛出 {@link ApiError}。
 */

/**
 * 封面描述。
 * @typedef {Object} PuzzleCover
 * @property {string} url 本站素材路径（`/api/puzzle/media/<id>`），可直接用
 * @property {string} alt 图片替代文本；已解时沿用主封面
 * @property {"16:9"|"4:3"|"1:1"} ratio 宽高比；已解时沿用主封面
 */

/**
 * 目录里的一个题目条目。
 * @typedef {Object} PuzzleMapPuzzle
 * @property {string} key 题目 key（用它调 `getView()`）
 * @property {string} title 题目名
 * @property {number} ord 排序，小在前
 * @property {"puzzle"} kind 条目类型
 * @property {"none"|"component"|"iframe"} renderKind 可塑区渲染方式
 * @property {boolean} solved 本队是否已解出
 * @property {boolean} unlocked 当前返回的题目均为 `true`
 * @property {PuzzleCover|null} cover 当前应显示的封面；未配置为 `null`
 */

/**
 * 文件夹/目录条目。
 * @typedef {Object} PuzzleMapFolder
 * @property {string} key 目录标识，如 `wave1`
 * @property {string} title 目录名
 * @property {number} ord 排序，小在前
 * @property {boolean} unlocked 当前返回的目录均为 `true`
 * @property {boolean} completed 该目录下全部已开放题目是否都已答对
 * @property {PuzzleMapPuzzle[]} children 只含已解锁题目
 */

/**
 * `getMap()` 的 `data`。
 * @typedef {Object} PuzzleMapData
 * @property {{ key: string, title: null, children: PuzzleMapFolder[] }} map
 *   虚拟根：`key` 固定 `stage0`、`title` 恒为 `null`（页面标题由前端决定）；
 *   `children` 只含已解锁目录（无题目的目录也会返回）
 * @property {{ solvedCount: number, totalPuzzles: number }} progress
 *   **可见**题目的进度：已解数 / 已解锁总数（不代表全部题目数）
 */

/**
 * 附件。
 * @typedef {Object} PuzzleAttachment
 * @property {"image"|"video"|"audio"|"pdf"|"file"|"link"} type 类型
 * @property {string} name 展示名
 * @property {string} url 本站素材路径；`link` 为外链 https；`pdf` / `file` 自带 `?download=1`
 * @property {number} [sizeBytes] 字节数（`link` 类型没有该字段）
 * @property {number} [durationSec] 音视频时长（可能没有该字段）
 * @property {string} [note] 出题人备注（可能没有该字段）
 */

/**
 * 预置提示（未购买时只有名称与价格）。
 * @typedef {Object} PuzzleHint
 * @property {number} id 提示 id（购买接口用）
 * @property {string} name 提示名称（未购买也下发）
 * @property {number} cost 价格（tips 点数）
 * @property {boolean} unlocked 本队是否已可看正文（已购买**或**价格为 0）
 * @property {string} [content] 仅 `unlocked: true` 时返回
 */

/**
 * 可塑区描述。
 * @typedef {Object} PuzzleMalleable
 * @property {"component"|"iframe"} kind 可塑区类型
 * @property {boolean} wide `true` 时容器加宽（960），其余排版仍由宿主决定
 * @property {number} minHeight 骨架高度（默认 320）
 * @property {Object} [props] 仅 `component`：出题人配置的 props（原样透传）
 * @property {string} [url] 仅 `iframe`：外链地址；启用 ticket 时为 `url#pz_ticket=<JWT>`（fragment，不是 query）
 * @property {{ tag: string, url: string, integrity: string, bytes: number }|null} [asset]
 *   仅 `component`：组件描述符（组件代码不在 view 里）；取回 ESM 后必须校验 `integrity`
 */

/**
 * 本队该题进度（始终存在）。
 * @typedef {Object} PuzzleTeamProgress
 * @property {string|null} firstTakenAt 首次取题时间；历史题无记录 → `null`
 * @property {string|null} firstSolvedAt 首次完成时间（重复作答不变）；未解出 → `null`
 * @property {number} submissionCount 提交次数（含答错与已解后的重复提交）
 */

/**
 * 组件状态快照。
 * @typedef {Object} PuzzleRuntime
 * @property {number} rev 状态版本：无行 `0`，首次写入 `1`，每次成功写入 +1；与页面 `rev` 是两个版本
 * @property {Object} state 组件自定义 JSON（**不可信共享存档**，服务端不解释业务语义）
 */

/**
 * 单题视图里的题目对象。
 * @typedef {Object} PuzzleView
 * @property {string} key 题目 key
 * @property {number} rev 页面版本号（每次保存 +1，可作前端缓存键）
 * @property {boolean} solved 本队是否已解出
 * @property {string} title 页面唯一 H1
 * @property {PuzzleCover|null} cover 封面；`null` 时整块不渲染；已解时按进度返回完成态封面
 * @property {string|null} description 受限 Markdown 源文本；`null` 时整块不渲染；
 *   内联图片 `![alt](asset:<id>)` 已在下发时改写为 `![alt](/api/puzzle/media/<id>)`
 * @property {Object<string, string>} [media] 描述内联图片映射 `{ "<素材id>": "/api/puzzle/media/<id>" }`；
 *   无引用（或全部解析不到）时该字段不出现
 * @property {PuzzleMalleable|null} malleable 可塑区；`null` 时整块不渲染
 * @property {PuzzleAttachment[]} attachments 附件；空数组时整块不渲染
 * @property {PuzzleHint[]} hints 预置提示；始终存在，无提示时为 `[]`
 * @property {PuzzleTeamProgress} teamProgress 本队该题进度（始终存在）
 * @property {PuzzleRuntime} [runtime] 仅 `kind=component` 且非预览时出现；无状态行时为 `{ rev: 0, state: {} }`
 */

/**
 * `getState()` 的 `data`。
 * @typedef {Object} PuzzleStateData
 * @property {number} rev 当前状态版本；没有状态行时为 `0`
 * @property {Object} state 组件自定义 JSON；没有状态行时为 `{}`
 * @property {Object} [server] 平台 handler 的投影（字段由方法定义）；没有投影时不出现，
 *   且**永远**拿不到 raw `auth_state`
 */

/**
 * `rpc()` 的 `data`。
 * @typedef {Object} PuzzleRpcResult
 * @property {number} rev 写入后的新状态版本（= `prevRev + 1`）
 * @property {number} prevRev 本次写入期望的旧版本（= 请求里的 `rev`），用于「响应丢失」判定
 * @property {Object} state 写入后的完整客户端状态（jsonb canonical 形式，键顺序可能不同）
 * @property {Object|null} [data] 仅 B 方法：平台 handler 的判定 / 下一关结果；
 *   答错通常是 `200 + data.correct=false`，不是错误码
 * @property {string|null} [toast] 仅 B 方法：可选的轻提示文案（≤300 字符），不做全局 UI
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

/**
 * `buyHint()` 的 `data`。
 * @typedef {Object} HintPurchaseResult
 * @property {PuzzleHint} hint 该提示的最新状态（形状同视图里 `unlocked:true` 的项）
 * @property {number} charged 本次扣除的 tips；重复购买或免费提示为 `0`
 * @property {boolean} alreadyUnlocked 请求前提示是否已解锁
 * @property {number} balance 队伍最新 tips 余额
 */

/**
 * 一条提交记录。
 * @typedef {Object} PuzzleSubmission
 * @property {number} id 提交 id（翻页游标）
 * @property {number} accountId 提交人账号 id
 * @property {string} username 提交人用户名（取当前值）
 * @property {string} answer 提交内容原文（超过 200 字符按 200 截断）
 * @property {boolean} correct 本次是否答对（已解后再次答对也是 `true`）
 * @property {number|null} durationMs 客户端上报的 `duration_ms`
 * @property {string} createdAt 提交时间（ISO 8601）
 */

/**
 * `getSubmissions()` 的 `data`。
 * @typedef {Object} PuzzleSubmissionsData
 * @property {PuzzleSubmission[]} items 本队提交记录（`id` 倒序，最新在前）
 * @property {number|null} nextCursor 下一页游标（取 `id < cursor`）；没有更多时为 `null`
 * @property {boolean} hasMore 是否还有下一页
 */

/**
 * 本队进度快照（形状同 `GET /api/progress` 的 `progress`）。
 * @typedef {Object} PuzzleProgressSnapshot
 * @property {number} solvedCount 已解出数量
 * @property {number} score 当前得分
 * @property {number} totalPuzzles 可见题目总数
 * @property {string|null} firstSolveAt 首次解出时间
 * @property {string|null} lastSolveAt 最近一次解出时间
 * @property {string|null} lastPuzzle 最近解出的题目 key
 * @property {{ key: string, title: string, kind: string, tipsReward: number, hitAt: string }[]} milestones
 *   已达成里程碑
 */

/**
 * `submit()` 的 `data`。
 * @typedef {Object} PuzzleSubmitResult
 * @property {boolean} correct **本次**判题结果（已解后再次提交也会真实判题，答错为 `false`）
 * @property {boolean} alreadySolved 本队此前是否已解出；`true` 时不再推进度、不发奖，但本次提交仍会记录
 * @property {string} puzzleKey 题目 key
 * @property {string} [solvedAt] 仅 `alreadySolved:true` 时出现：该队首次完成时间
 * @property {PuzzleProgressSnapshot} progress 本队最新进度快照
 * @property {{ balance: number, delta: number }} tips 最新余额与本次净变化；只有首次答对且有奖励时 `delta > 0`
 * @property {{ key: string, title: string, tipsReward: number }[]} newMilestones
 *   本次新达成的里程碑；没有则 `[]`
 */

export const puzzleApi = {
  /**
   * 读取题目结构（虚拟根 `stage0` → 目录 → 题目）。
   *
   * - 接口：`GET /api/puzzle/map`
   * - 鉴权：需要访问令牌 + 取题门禁
   * - 文档：api-12-puzzle.md §一（`GET /api/puzzle/map`）
   *
   * 只返回**已解锁**的目录与题目（未解锁连 key 都没有）：不要根据缺失条目猜测题目 key，
   * 也不要自行补齐。解题后重新请求本接口刷新状态，无需轮询。
   *
   * @returns {Promise<{ ok: boolean, data: PuzzleMapData, req_id: string }>}
   * @throws {ApiError}
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：所在队伍被封禁（`detail.reason` / `detail.until`）
   *   - 409 `E_CONFLICT`：`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`
   */
  getMap: () =>
    request("/puzzle/map", {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 读取单题五元素视图（不含答案）。
   *
   * - 接口：`GET /api/puzzle/:key`
   * - 鉴权：需要访问令牌 + 取题门禁 + 题目已解锁
   * - 文档：api-12-puzzle.md §一（`GET /api/puzzle/:key`）
   *
   * `data.puzzle.teamProgress` 始终存在（首次取题 / 首次完成时间与提交次数）；
   * 可塑区相关字段见 `PuzzleMalleable` / `PuzzleRuntime`。
   *
   * @param {string} key 题目 key（来自 `getMap()`；会做 URL 编码）
   * @returns {Promise<{ ok: boolean, data: { puzzle: PuzzleView }, req_id: string }>}
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：参数不合法
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：所在队伍被封禁（`detail.reason` / `detail.until`）
   *   - 404 `E_NOT_FOUND`：题目不存在 / 停用 / 尚未解锁（同形，防枚举）
   *   - 409 `E_CONFLICT`：`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`
   */
  getView: (key) =>
    request(`/puzzle/${encodeURIComponent(String(key ?? ""))}`, {
      method: "GET",
      useAuth: true,
    }),

  /**
   * 可塑区方法调用 / 组件状态写入（仅 `kind=component` 的题可用）。
   *
   * - 接口：`POST /api/puzzle/:key/rpc`
   * - 鉴权：需要访问令牌 + 取题门禁 + 已解锁 + `kind=component`
   * - 文档：api-12-puzzle.md §二（`POST /api/puzzle/:key/rpc`）
   *
   * `method` 两类：
   * - A：`state.put`（整份替换）/ `state.patch`（只合并**顶层** own 键，删除键请用 `put`）；
   * - B：平台注册的 `<puzzleKey>.<method>`（如 `day2_02.sudoku.submit`），语义由平台 handler 定义。
   *
   * `rev` 是当前快照的 `runtime.rev`（首写传 `0`），服务端据此做 CAS。
   * **B 类有副作用的方法必须带 `idempotencyKey`**：同一 key 的重试返回首次响应、不重复执行，
   * 网络超时务必复用同一个 key。
   *
   * @param {string} key 题目 key
   * @param {Object} body
   * @param {string} body.method `state.put` / `state.patch` / `<puzzleKey>.<method>`
   * @param {Object} [body.payload] 方法参数对象（缺省 `{}`；`state.*` 必须是目标绝对值）
   * @param {number} body.rev 客户端当前 `runtime.rev`（首写传 `0`）
   * @param {Object} [options]
   * @param {string} [options.idempotencyKey] 8–128 位字母数字 / `._~-`（推荐 UUID）；
   *   B 有副作用方法必填，只读方法可不带
   * @param {AbortSignal} [options.signal] 取消信号
   * @returns {Promise<{ ok: boolean, data: PuzzleRpcResult, req_id: string }>}
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：信封 / 结构 / 方法 / 大小不合法
   *     detail.reason_code：
   *       `INVALID_BODY` -- 信封或结构非法
   *       `METHOD_UNSUPPORTED` -- 未知或未注册的 method
   *       `STATE_TOO_LARGE` -- 合并后超过 16KB
   *       `INVALID_JSON_CHARS` -- 含 NUL / 孤立代理项
   *       `IDEMPOTENCY_KEY_REQUIRED` -- B 有副作用方法缺 `Idempotency-Key`
   *       `IDEMPOTENCY_KEY_INVALID` -- key 格式不合法
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`、`E_FORBIDDEN`：账号 / 队伍被封禁（队伍禁言不影响）
   *     detail.reason_code：
   *       `ACCOUNT_BANNED` -- 账号封禁
   *       `TEAM_BANNED` -- 队伍封禁（另带 `reason` / `until`）
   *   - 404 `E_NOT_FOUND`：题目不可用
   *     detail.reason_code：
   *       `PUZZLE_UNAVAILABLE` -- 不存在 / 停用 / 未解锁（同形，防枚举）
   *       `RPC_UNSUPPORTED` -- 已解锁但不是 component 题
   *   - 409 `E_CONFLICT`：版本冲突或门禁不通
   *     detail.reason_code：
   *       `PZ_STATE_CONFLICT` -- 其他成员 / 标签页先写成功（带 `latest_rev` / `latest_state`，
   *                              先用它更新本地快照再决定是否退避重试，不要原样重放增量意图）
   *       `STATE_VERSION_UNSUPPORTED` -- B：状态结构版本不兼容（`detail.supported_version`，需刷新 / 升级）
   *       `NO_TEAM`、`TEAM_NOT_CONFIRMED`、`CONTEST_NOT_STARTED` -- 取题门禁
   *   - 429 `E_QUOTA`：限流
   *     detail.reason_code：
   *       `PZ_RPC_RATE_LIMITED` -- 账号 / 队伍 / 方法限流；按 `detail.retry_after_sec`（同 `Retry-After`）退避
   *       `PZ_RPC_ATTEMPTS_EXCEEDED` -- B：平台方法尝试上限
   *   - 500 `E_INTERNAL`：内置方法不应出现；B handler 异常 / 契约违规也会 500 且不写库（上报 `req_id`）
   */
  rpc: (key, { method, payload, rev }, { idempotencyKey, signal } = {}) =>
    request(`/puzzle/${encodeURIComponent(String(key ?? ""))}/rpc`, {
      method: "POST",
      useAuth: true,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      body: { method, payload, rev },
      signal,
    }),

  /**
   * 组件状态轻量读（桥 `refresh()` 用，避免 409 后重拉整个题目视图）。
   *
   * - 接口：`GET /api/puzzle/:key/state`
   * - 鉴权：与写接口相同（登录 + 取题门禁 + 已解锁 + `kind=component`）
   * - 文档：api-12-puzzle.md §二（`GET /api/puzzle/:key/state`）
   *
   * 只读、无副作用。注册了平台 handler 且提供投影函数时，`data.server` 会额外下发
   * （字段由方法定义）；没有投影时该字段不出现。
   *
   * @param {string} key 题目 key
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] 取消信号
   * @returns {Promise<{ ok: boolean, data: PuzzleStateData, req_id: string }>}
   *   无状态行时为 `{ rev: 0, state: {} }`。
   * @throws {ApiError}
   *   - 错误码与 `rpc()` 相同（404 同样是 `PUZZLE_UNAVAILABLE` / `RPC_UNSUPPORTED`）
   *   - 429 `E_QUOTA`：`detail.reason_code` 为 `PZ_STATE_RATE_LIMITED`；按 `detail.retry_after_sec` 退避
   */
  getState: (key, { signal } = {}) =>
    request(`/puzzle/${encodeURIComponent(String(key ?? ""))}/state`, {
      method: "GET",
      useAuth: true,
      signal,
    }),

  /**
   * 购买一条预置提示（队伍级买断、只扣一次、不可退款）。
   *
   * - 接口：`POST /api/puzzle/:key/hints/:id/buy`
   * - 鉴权：需要访问令牌 + 取题门禁（不要求禁言状态）
   * - 文档：api-12-puzzle.md §五（`POST /api/puzzle/:key/hints/:id/buy`）
   *
   * 扣**本队** tips，解锁后全队可见；`:id` 来自单题视图的 `hints[].id`。
   * 重复 / 并发点击返回 `charged: 0` + `alreadyUnlocked: true`。
   * 购买即消费：出题人后续删除 / 修改提示都不退 tips。
   *
   * @param {string} key 题目 key
   * @param {number|string} id 提示 id（`hints[].id`）
   * @returns {Promise<{ ok: boolean, data: HintPurchaseResult, req_id: string }>}
   * @throws {ApiError}
   *   - 400 `E_TIPS_SHORT`：本队 tips 不足（`detail.balance` / `detail.required`）；
   *     不扣费、不产生购买记录
   *   - 400 `E_VALIDATION`：`:id` 格式不合法
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`、`E_FORBIDDEN`：账号 / 队伍被封禁
   *   - 404 `E_NOT_FOUND`：题目不存在 / 未解锁 / 提示不存在或不属于该题（同形，防枚举）
   *   - 409 `E_CONFLICT`：`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`
   */
  buyHint: (key, id) =>
    request(
      `/puzzle/${encodeURIComponent(String(key ?? ""))}/hints/${encodeURIComponent(String(id ?? ""))}/buy`,
      {
        method: "POST",
        useAuth: true,
      },
    ),

  /**
   * 读取本队该题的提交历史（队伍内可见，含答错与已解后的重复提交）。
   *
   * - 接口：`GET /api/puzzle/:key/submissions`
   * - 鉴权：需要访问令牌 + 取题门禁 + 题目已解锁（未解锁与不存在同形 `404`）
   * - 文档：api-12-puzzle.md §一（`GET /api/puzzle/:key/submissions`）
   *
   * 只返回**本队**数据（服务端按登录账号所属队伍过滤，不接受队伍参数），不跨题、不跨队。
   *
   * @param {string} key 题目 key
   * @param {Object} [query]
   * @param {number} [query.cursor=0] 取 `id < cursor`（`0` = 第一页）
   * @param {number} [query.limit=50] 每页条数（1–100）
   * @returns {Promise<{ ok: boolean, data: PuzzleSubmissionsData, req_id: string }>}
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：参数不合法
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`：所在队伍被封禁
   *   - 404 `E_NOT_FOUND`：题目不存在 / 停用 / 尚未解锁（同形，防枚举）
   *   - 409 `E_CONFLICT`：`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`
   */
  getSubmissions: (key, { cursor = 0, limit = 50 } = {}) =>
    request(
      `/puzzle/${encodeURIComponent(String(key ?? ""))}/submissions`,
      {
        method: "GET",
        useAuth: true,
        params: { cursor, limit },
      },
    ),

  /**
   * 提交答案（判题并推进本队进度；首次答对才发奖与判定里程碑）。
   *
   * - 接口：`POST /api/puzzle/submit`
   * - 鉴权：需要访问令牌 + 取题门禁
   * - 文档：api-12-puzzle.md §一（`POST /api/puzzle/submit`）
   *
   * 请求体是 **snake_case**（`puzzle_key` / `duration_ms`）。注意语义：
   * - `correct` 是**本次**判题结果：本队已解出后再提交同样会真实判题，答错仍记一条记录；
   * - `alreadySolved` 只表示本队此前已解出，此时不重复推进度、不发奖，并附首次完成时间 `solvedAt`；
   * - `duration_ms` 仅留痕用于统计（0–86400000），可选。
   *
   * @param {Object} payload
   * @param {string} payload.puzzleKey 题目 key（trim 后 ≤ 64 字符）
   * @param {string} payload.answer 提交的答案（≤ 200 字符）
   * @param {number} [payload.durationMs] 本题耗时（0–86400000，仅统计）
   * @returns {Promise<{ ok: boolean, data: PuzzleSubmitResult, req_id: string }>}
   * @throws {ApiError}
   *   - 400 `E_VALIDATION`：`puzzle_key` / `answer` 缺失或越界
   *     detail.fields：
   *       `puzzle_key` -- 缺失 / 超过 64 字符
   *       `answer` -- 缺失 / 超过 200 字符
   *   - 401 `E_AUTH`：未登录或令牌失效
   *   - 403 `E_BANNED`、`E_FORBIDDEN`：账号被封禁 / 队伍被封禁
   *   - 404 `E_NOT_FOUND`：题目不存在或尚未解锁（同形，防枚举）；**不判题、不产生提交记录**
   *   - 409 `E_CONFLICT`：`你还没有队伍` / `队伍尚未确认参赛` / `比赛尚未开始`
   *   - 429 `E_QUOTA`：提交过于频繁（`detail.retry_after_sec` + 响应头 `Retry-After`），按秒数等待
   */
  submit: ({ puzzleKey, answer, durationMs }) =>
    request("/puzzle/submit", {
      method: "POST",
      useAuth: true,
      body: {
        puzzle_key: puzzleKey,
        answer,
        ...(Number.isFinite(durationMs) ? { duration_ms: durationMs } : {}),
      },
    }),
};

export default puzzleApi;
