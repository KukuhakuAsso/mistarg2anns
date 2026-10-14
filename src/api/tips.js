import request from "@/api/request";

// 队伍级 tips 接口。无队伍时后端返回 200 + teamId:null + 零值，属正常空值状态，不是错误。
export const tipsApi = {
  // 队伍 tips 余额与规则（GET /api/tips/balance）；rule.hint_cost 为人工求提示单价
  getBalance: () =>
    request("/tips/balance", {
      method: "GET",
      useAuth: true,
    }),

  // 队伍 tips 流水（GET /api/tips/ledger?cursor=&limit=）
  getLedger: ({ cursor = 0, limit = 20 } = {}) =>
    request("/tips/ledger", {
      method: "GET",
      params: { cursor, limit },
      useAuth: true,
    }),
};

export default tipsApi;
