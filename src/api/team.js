import request from "@/api/request";

// 队伍接口封装：所有 /api/team/* 均要求登录，因此统一使用 useAuth: true。
// 成功响应为 { ok: true, data, req_id }；失败为 { ok: false, error: { code, message, detail }, req_id }。
// 失败时 request 会抛出带 status / code / payload 的 Error，调用方按需读取 error.payload.error.message。
export const teamApi = {
  // 获取我的队伍与我的加入申请（GET /api/team/me）
  getMyTeam: () =>
    request("/team/me", {
      method: "GET",
      useAuth: true,
    }),

  // 获取指定队伍详情（GET /api/team/:id）
  getTeam: (teamId) =>
    request(`/team/${teamId}`, {
      method: "GET",
      useAuth: true,
    }),

  // 创建队伍（POST /api/team），body: { name, intro? }
  createTeam: ({ name, intro } = {}) =>
    request("/team", {
      method: "POST",
      body: {
        name,
        ...(intro ? { intro } : {}),
      },
      useAuth: true,
    }),

  // 更换邀请码（POST /api/team/invite），旧码立即失效
  rotateInvite: () =>
    request("/team/invite", {
      method: "POST",
      useAuth: true,
    }),

  // 开关自动审批（POST /api/team/join/auto-approve），body: { enabled }
  setAutoApprove: (enabled) =>
    request("/team/join/auto-approve", {
      method: "POST",
      body: { enabled: Boolean(enabled) },
      useAuth: true,
    }),

  // 凭邀请码申请加入（POST /api/team/join），body: { code }
  applyJoin: (code) =>
    request("/team/join", {
      method: "POST",
      body: { code },
      useAuth: true,
    }),

  // 队长同意加入申请（POST /api/team/join/confirm），body: { request_id }
  confirmJoin: (requestId) =>
    request("/team/join/confirm", {
      method: "POST",
      body: { request_id: requestId },
      useAuth: true,
    }),

  // 队长拒绝加入申请（POST /api/team/join/reject），body: { request_id }
  rejectJoin: (requestId) =>
    request("/team/join/reject", {
      method: "POST",
      body: { request_id: requestId },
      useAuth: true,
    }),

  // 申请人取消自己的待确认申请（POST /api/team/join/cancel）
  cancelJoin: () =>
    request("/team/join/cancel", {
      method: "POST",
      useAuth: true,
    }),

  // 队长确认参赛（POST /api/team/start），确认后队伍进入锁定态
  startTeam: () =>
    request("/team/start", {
      method: "POST",
      useAuth: true,
    }),

  // 队长取消确认参赛（POST /api/team/start/cancel），仅官方开赛前可用
  cancelStart: () =>
    request("/team/start/cancel", {
      method: "POST",
      useAuth: true,
    }),

  // 队长移出成员（DELETE /api/team/member/:id），:id 为成员 accountId
  removeMember: (accountId) =>
    request(`/team/member/${accountId}`, {
      method: "DELETE",
      useAuth: true,
    }),

  // 退队（POST /api/team/leave），队长且无其他成员时会顺带解散
  leaveTeam: () =>
    request("/team/leave", {
      method: "POST",
      useAuth: true,
    }),

  // 队长转让（POST /api/team/transfer），body: { account_id }
  transferCaptain: (accountId) =>
    request("/team/transfer", {
      method: "POST",
      body: { account_id: accountId },
      useAuth: true,
    }),

  // 队长解散队伍（POST /api/team/dissolve）
  dissolveTeam: () =>
    request("/team/dissolve", {
      method: "POST",
      useAuth: true,
    }),
};

export default teamApi;
