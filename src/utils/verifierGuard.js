import {
    normalizeAnswerLoose,
    normalizeAnswerStrict,
} from "./answerNormalizer.js";

// --- 安全配置 ---
const MAX_ANSWER_LENGTH = 200; // 防止超长字符串攻击
// 可选：字符白名单校验（拒绝明显恶意的特殊字符）
function isAnswerSafe(str) {
    // 允许字母、数字、空格、常见标点（可按需增减）
    return /^[\p{L}\p{N}\s.,!?\-+*/@#$%^&()[\]{}|~`'"<>:;]+$/u.test(str);
}

// --- 在 checkAnswer 中的使用模式 ---
export function validateAndNormalize(raw, mode = "loose") {
    if (!raw) return { valid: false, error: "请输入答案" };

    let normalized =
        mode === "strict"
            ? normalizeAnswerStrict(raw)
            : normalizeAnswerLoose(raw);
    if (!normalized) return { valid: false, error: "答案无效" };

    if (normalized.length > MAX_ANSWER_LENGTH)
        return { valid: false, error: "答案过长" };
    if (!isAnswerSafe(normalized))
        return { valid: false, error: "包含非法字符" };

    return { valid: true, normalized };
}
