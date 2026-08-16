const apiBase = import.meta.env.VITE_API_MIST_BASE || "";

// 获取存储的 token
function getToken() {
    return localStorage.getItem("game_token");
}

export class TokenExpiredError extends Error {
    constructor(message = "游戏凭证已过期") {
        super(message);
        this.name = "TokenExpiredError";
    }
}

export class TokenMissingError extends Error {
    constructor(message = "游戏凭证不存在") {
        super(message);
        this.name = "TokenMissingError";
    }
}

// 带JWT鉴权的 fetch方法
export async function authFetch(url, options = {}) {
    const token = getToken();
    if (!token || token === '') {
        throw new TokenMissingError()
    }
    const headers = {
        ...options.headers,
        Authorization: token ? `Bearer ${token}` : "",
        "Content-Type": "application/json",
    };
    const res = await fetch(`${apiBase}${url}`, {...options, headers});

    if (res.status === 401) {
        const data = await refreshToken();
        if (!data.token) {
            throw new TokenExpiredError();
        }
    }

    return res;
}

// 新游戏初始token获取
export async function startGame() {
    const res = await fetch(`${apiBase}/An2/start`, {method: "POST"});
    const data = await res.json();
    if (data.token) {
        localStorage.setItem("game_token", data.token);
    }
    return data;
}

// 游戏token刷新
export async function refreshToken() {
    const res = await authFetch(`${apiBase}/An2/refresh`, {method: "POST"});
    const data = await res.json();
    if (data.token) {
        localStorage.setItem("game_token", data.token);
    }
    return data;
}

// 游戏流程获取(获取题目)
export async function getQuest(pointId) {
    const res = await authFetch(`${apiBase}/An2/getQuest/${pointId}`, {method: "POST"});
    return await res.json();
}

// 游戏流程控制(提交答案获取下一步)
export async function getFlow(question, answer) {
    const res = await authFetch(
        `${apiBase}/An2/getFlow/${encodeURIComponent(question)}?answer=${encodeURIComponent(answer)}`,
        { method: "POST" }
    );
    return await res.json();
}

