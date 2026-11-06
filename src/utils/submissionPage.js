// 提交历史分页响应的归一化。
//
// 玩家端的 request() 返回的是**整个响应体**（{ ok, data, req_id }），
// 而管理端的 http.js 直接返回 data —— 两者不同。这里统一收口，
// 免得调用方各自猜「该取几层」（取错一层就会静默变成空列表）。
export function normalizeSubmissionPage(payload) {
  // 主路径：完整响应体；兼容只拿到 data 的调用方
  const data = payload?.data ?? payload ?? {};

  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor: data.nextCursor ?? null,
    hasMore: Boolean(data.hasMore),
  };
}

// 单条提交记录 → 展示用字段；后端可能缺字段，这里补齐成稳定形状
export function toSubmissionRow(item) {
  // 注意不能直接 Number(item.durationMs)：Number(null) === 0，
  // 会把「客户端没上报时长」显示成「用时 0秒」
  const rawDuration = item?.durationMs;
  const durationMs = rawDuration == null ? null : Number(rawDuration);
  return {
    id: item?.id,
    accountId: item?.accountId ?? null,
    username: item?.username || "",
    answer: item?.answer == null ? "" : String(item.answer),
    correct: Boolean(item?.correct),
    durationMs:
      Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    createdAt: item?.createdAt ?? null,
  };
}
