import request from "@/api/request";

// 账号处罚状态与申诉（api-11-moderation-mute.md）。
// 这三条 /me/* 接口是封禁账号唯一还能用的接口族，所以一律 useAuth + 允许刷新令牌。
export const meApi = {
  // 账号状态（轮询用，建议 30–60s）：封禁 / 账号级禁言 / 所在队伍处罚 + 两级申诉摘要
  getStatus: () =>
    request("/me/status", {
      method: "GET",
      useAuth: true,
    }),

  // 申诉链：scope=account（默认）为自己账号级处罚；team 为队长代表队伍（队伍级禁言 / 队伍封禁）。
  // 返回 { scope, kind, teamId?, appeal, mails }；没有可申诉处罚时 kind:null + mails:[]
  // kind=ban 由服务端按主体判定是账号封禁还是队伍封禁（队伍封禁只有队长拿得到）
  getAppeal: (scope = "account") =>
    request("/me/appeal", {
      method: "GET",
      params: { scope },
      useAuth: true,
    }),

  // 提交一条申诉：{ content(1..2000), scope?, attachments? }；种类由服务端判定，前端不传 kind / subject。
  // attachments（2026-10-31 起）：[{ objectKey, filename, mime, sizeBytes }]，≤3 张，个人/队伍申诉都支持。
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
