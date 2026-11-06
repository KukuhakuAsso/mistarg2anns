// 题目模块（api-12）：题目结构、单题五元素视图与答案提交。
//
// 取题门禁与进度解锁全部由后端判定，前端只按错误码分支：
//   401 E_AUTH / 403 E_BANNED / 404 E_NOT_FOUND（含「尚未解锁」，与不存在同形）/ 409 E_CONFLICT。
import request from "@/api/request";

export const puzzleApi = {
  // 题目结构：虚拟根 stage0 → 目录 → 题目；只返回已解锁项（未解锁连 key 都没有）。
  getMap: () =>
    request("/puzzle/map", {
      method: "GET",
      useAuth: true,
    }),

  // 单题五元素视图；不含答案。
  // 另含 teamProgress（始终存在）：{ firstTakenAt, firstSolvedAt, submissionCount }，
  // 分别是本队首次取题时间、首次完成时间（重复作答不变）与提交次数（含答错与已解后的重复提交）。
  getView: (key) =>
    request(`/puzzle/${encodeURIComponent(String(key ?? ""))}`, {
      method: "GET",
      useAuth: true,
    }),

  // 购买一条预置提示（api-10 §10.11）。无请求体；队伍级买断、只扣一次、不可退款。
  // 成功 data: { hint, charged, alreadyUnlocked, balance }；余额不足 → 400 E_TIPS_SHORT。
  buyHint: (key, id) =>
    request(
      `/puzzle/${encodeURIComponent(String(key ?? ""))}/hints/${encodeURIComponent(String(id ?? ""))}/buy`,
      {
        method: "POST",
        useAuth: true,
      },
    ),

  // 本队该题的提交历史（api-12 § 提交历史）：只返回本队数据，含答错与已解后的重复提交。
  // 查询参数 cursor（默认 0，取 id < cursor）与 limit（1–100，默认 50）；id 倒序。
  // 响应 data: { items: [{ id, accountId, username, answer, correct, durationMs, createdAt }], nextCursor, hasMore }
  getSubmissions: (key, { cursor = 0, limit = 50 } = {}) =>
    request(
      `/puzzle/${encodeURIComponent(String(key ?? ""))}/submissions`,
      {
        method: "GET",
        useAuth: true,
        params: { cursor, limit },
      },
    ),

  // 提交答案。请求体字段为 snake_case（与后端实测一致），
  // 响应 data: { correct, alreadySolved, puzzleKey, solvedAt?, progress, tips, newMilestones }。
  //   * correct 是「本次」判题结果：本队已解出后再提交同样会真实判题，答错仍记一条记录；
  //   * alreadySolved 只表示本队此前已解出，此时不重复推进度、不发奖，并附首次完成时间 solvedAt；
  //   * duration_ms 仅留痕用于统计（0–86400000），可选。
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
