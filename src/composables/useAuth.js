import { authApi } from "@/api/auth";
import { setAccessToken } from "@/api/request";

export function normalizeLoginType(type) {
    const value = String(type ?? "").trim().toLowerCase();
    if (["email", "username", "player_no"].includes(value)) {
        return value;
    }

    throw new Error("登录类型不支持。");
}

export function formatRetryWaitText(retryAfterSec) {
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

export function useAuth() {
    async function loginWithPassword({ type, identifier, password }) {
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
                expiresIn: Number(payload.expires_in ?? 7200),
                account: payload.account ?? null,
                response,
            };
        } catch (error) {
            const payload = error?.payload ?? {};
            const code = payload?.code || payload?.error?.code || error?.code || "";
            const detail = payload?.detail ?? payload?.error?.detail ?? {};
            const retryAfterSec = Number(detail?.retry_after_sec ?? 0);

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

    return {
        loginWithPassword,
        normalizeLoginType,
        formatRetryWaitText,
    };
}
