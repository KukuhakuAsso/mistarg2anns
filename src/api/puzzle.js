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
  getView: (key) =>
    request(`/puzzle/${encodeURIComponent(String(key ?? ""))}`, {
      method: "GET",
      useAuth: true,
    }),

  // 提交答案。请求体字段为 snake_case（与后端实测一致），
  // 响应 data: { correct, alreadySolved, puzzleKey, progress, tips, newMilestones }。
  submit: ({ puzzleKey, answer }) =>
    request("/puzzle/submit", {
      method: "POST",
      useAuth: true,
      body: {
        puzzle_key: puzzleKey,
        answer,
      },
    }),
};

export default puzzleApi;
