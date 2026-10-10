// 登录（账号密码）相关逻辑：归一化入参、调用登录接口并保存 access token，
// 同时把后端返回的错误码翻译成可直接展示给用户的中文提示。
import { authApi } from "@/api/auth";
import { setAccessToken } from "@/api/request";

// 归一化登录类型为 email / username / player_no；其他值直接抛错。
function normalizeLoginType(type) {
  const value = String(type ?? "").trim().toLowerCase();
  if (["email", "username", "player_no"].includes(value)) {
    return value;
  }

  throw new Error("登录类型不支持。");
}

// 把「还需等待的秒数」格式化成 X 分 Y 秒；无有效值时返回「稍后」。
function formatRetryWaitText(retryAfterSec) {
  const totalSeconds = Number(retryAfterSec ?? 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "稍后";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }

  return `${seconds} 秒`;
}

// 密码登录：成功后保存 access token 并回传账号信息；失败时按后端错误码抛出中文提示。
export async function loginWithPassword({ type, identifier, password }) {
  const loginType = normalizeLoginType(type);
  const loginIdentifier = String(identifier ?? "").trim();
  const loginPassword = String(password ?? "").trim();

  if (!loginIdentifier) {
    throw new Error("登录标识不能为空。");
  }

  if (!loginPassword) {
    throw new Error("密码不能为空。");
  }

  try {
    const response = await authApi.login({
      type: loginType,
      identifier: loginIdentifier,
      password: loginPassword,
    });

    const payload = response?.data ?? response ?? {};
    const token = payload.access_token || payload.token || "";
    if (token) {
      setAccessToken(token);
    }

    return {
      ok: true,
      accessToken: token,
      // 后端未返回有效期时按 2 小时兜底。
      expiresIn: Number(payload.expires_in ?? 7200),
      account: payload.account ?? null,
      response,
    };
  } catch (error) {
    // 后端错误体形如 { code, detail }，可能直接抛出，也可能包在 error.payload / error 里。
    const payload = error?.payload ?? {};
    const code = payload?.code || payload?.error?.code || error?.code || "";
    const detail = payload?.detail ?? payload?.error?.detail ?? {};
    const retryAfterSec = Number(detail?.retry_after_sec ?? 0);

    // 错误码 → 展示文案：E_VALIDATION 参数格式、E_AUTH 凭据错误、
    // E_BANNED 账号封禁（可带原因）、E_QUOTA 触发频率限制（可带需等待的秒数）。
    if (code === "E_VALIDATION") {
      throw new Error("登录信息格式不正确。");
    }

    if (code === "E_AUTH") {
      throw new Error("账号或密码错误。");
    }

    if (code === "E_BANNED") {
      throw new Error(detail?.reason ? `账号已被封禁：${detail.reason}` : "账号已被封禁。");
    }

    if (code === "E_QUOTA") {
      const waitText = formatRetryWaitText(retryAfterSec);
      throw new Error(
        retryAfterSec > 0
          ? `登录过于频繁，请等待 ${waitText} 后再试。`
          : "登录过于频繁，请稍后再试。",
      );
    }

    throw new Error(error?.message || "登录失败。");
  }
}
