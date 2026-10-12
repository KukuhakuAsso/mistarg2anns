// 队名规则（与后端 validateTeamName 对齐）：
// 1–32 个字符，只允许各国文字 / 数字 / 空格与常见 ASCII 标点，禁止 emoji、不可见字符与组合音标。
// 与用户名规则的差异：@ 与 M2xxxxxx 编号形态在这里是允许的，那两条限制只对用户名生效。
const ALLOWED_NAME_PATTERN = /^[\p{L}\p{N}\p{Zs}_\-.+&'()\[\]!#$%*=?^{|}~@]+$/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const INVISIBLE_PATTERN = /\p{C}/u; // 控制字符、零宽字符、双向文本控制符等
const COMBINING_PATTERN = /\p{M}/u; // 组合音标

export const TEAM_NAME_MAX_LENGTH = 32;

// 归一化队名：NFC 规范化并去掉首尾空白（中间空格保留，因此「我的 队伍」与「我的队伍」是两个队名）。
export function normalizeTeamName(value) {
  return String(value ?? "").normalize("NFC").trim();
}

// 校验队名：通过返回 { ok: true, value }（已归一化），否则返回 { ok: false, message }。
export function validateTeamName(value) {
  const name = normalizeTeamName(value);

  if (!name) {
    return { ok: false, message: "请填写队伍名称。" };
  }

  if (name.length > TEAM_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `队伍名称最多 ${TEAM_NAME_MAX_LENGTH} 个字符。`,
    };
  }

  if (EMOJI_PATTERN.test(name)) {
    return { ok: false, message: "队伍名称不能包含 emoji。" };
  }

  if (INVISIBLE_PATTERN.test(name)) {
    return {
      ok: false,
      message: "队伍名称不能包含换行、制表符等控制字符或不可见字符。",
    };
  }

  if (COMBINING_PATTERN.test(name)) {
    return { ok: false, message: "队伍名称不能包含组合音标等组合字符。" };
  }

  if (!ALLOWED_NAME_PATTERN.test(name)) {
    return { ok: false, message: "队伍名称包含不允许的字符。" };
  }

  return { ok: true, value: name };
}
