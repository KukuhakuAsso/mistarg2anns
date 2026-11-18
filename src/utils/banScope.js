// 封禁类 403 的作用域判定（api-12 取题门禁，2026-11-18 起）。
//
// 后端在 error.detail.reason_code 里区分两种封禁：
//   ACCOUNT_BANNED —— 账号被封（令牌全部失效，必须重新登录）
//   TEAM_BANNED    —— 所在队伍被封（账号本身正常，令牌仍然有效，不能登出）
// 旧后端不带 reason_code：按账号封禁处理，保持既有行为。
export const BAN_SCOPE_ACCOUNT = "account";
export const BAN_SCOPE_TEAM = "team";

export function resolveBanScope(detail) {
  return detail?.reason_code === "TEAM_BANNED"
    ? BAN_SCOPE_TEAM
    : BAN_SCOPE_ACCOUNT;
}

// 从抛出的错误对象读封禁作用域：请求层已把 reason_code 落到 error.reasonCode，
// 兼容老的错误体（payload.error.detail）。
export function resolveErrorBanScope(error) {
  const reasonCode =
    error?.reasonCode ||
    error?.payload?.error?.detail?.reason_code ||
    error?.payload?.detail?.reason_code ||
    "";
  return reasonCode === "TEAM_BANNED" ? BAN_SCOPE_TEAM : BAN_SCOPE_ACCOUNT;
}

// GET /me/status 的 banned 是**等效门禁状态**（max(个人, 队伍)），不能直接当成「账号被封」：
// 队伍封禁时 banned 同样为 true，但令牌仍然有效，前端不能登出、也不能显示成账号封禁。
// 判定：不在封禁队伍里 → 只能是个人封禁；在封禁队伍里 → 个人申诉块 kind=ban 才是本人也被封。
export function isAccountBanStatus(status) {
  if (!status?.banned) return false;
  const teamBanned = status?.team?.status === 4;
  if (!teamBanned) return true;
  return status?.appeal?.kind === "ban";
}

export default resolveBanScope;
