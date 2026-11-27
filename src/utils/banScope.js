// 封禁类 403 的作用域判定
export const BAN_SCOPE_ACCOUNT = "account";
export const BAN_SCOPE_TEAM = "team";

export function resolveBanScope(detail) {
  return detail?.reason_code === "TEAM_BANNED"
    ? BAN_SCOPE_TEAM
    : BAN_SCOPE_ACCOUNT;
}

// 从抛出的错误对象读封禁作用域
export function resolveErrorBanScope(error) {
  return error?.reasonCode === "TEAM_BANNED"
    ? BAN_SCOPE_TEAM
    : BAN_SCOPE_ACCOUNT;
}

// 判定：不在封禁队伍里 → 只能是个人封禁；在封禁队伍里 → 个人申诉块 kind=ban 才是本人也被封。
export function isAccountBanStatus(status) {
  if (!status?.banned) return false;
  const teamBanned = status?.team?.status === 4;
  if (!teamBanned) return true;
  return status?.appeal?.kind === "ban";
}

export default resolveBanScope;
