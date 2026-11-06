import request from "@/api/request";

// 线索栏快照（api-13）：只存板面卡片与移除墓碑，标题 / 封面仍由 GET /puzzle/map 提供。
//
// 语义要点：
//   · 上传是增量 —— items 里没出现的线索不会被动；
//   · 移除要显式 POST { clue_id, removed: true }；
//   · POST 同账号 5 分钟一次，超限 429 E_QUOTA + Retry-After；GET 不限流。
export const clueBoardApi = {
  // 本账号全部线索行（按 clue_id 升序，含墓碑）：{ items, synced_at }
  getSnapshot: () =>
    request("/me/clue-board", {
      method: "GET",
      useAuth: true,
    }),

  // 上传本机差异；响应是合并后的服务端全量快照（形状与 GET 一致）。
  putSnapshot: ({ device, items }) =>
    request("/me/clue-board", {
      method: "POST",
      useAuth: true,
      body: { device, items },
    }),
};

export default clueBoardApi;
