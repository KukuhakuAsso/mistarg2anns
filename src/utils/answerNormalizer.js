import { ref, readonly } from "vue";

/**
 * 宽松规范化
 * - 全角转半角、去空格/标点
 */
function normalizeAnswerLoose(input) {
    if (input == null) return "";
    // 如果全局对象提供了更精确的实现，直接使用
    if (
        typeof window !== "undefined" &&
        window.PuzzleSecretVerifier &&
        typeof window.PuzzleSecretVerifier.normalizeAnswerLoose === "function"
    ) {
        return window.PuzzleSecretVerifier.normalizeAnswerLoose(input);
    }
    let str = String(input);
    // 全角转半角
    str = str.replace(/[\u3000\uFF01-\uFF5E]/g, (ch) => {
        const code = ch.charCodeAt(0);
        return code === 0x3000 ? " " : String.fromCharCode(code - 0xfee0);
    });
    // 去掉所有空格和标点
    str = str.replace(/[\s\p{P}]+/gu, "");
    return str;
}

/**
 * 严格规范化
 * - 优先使用全局 PuzzleSecretVerifier（若存在）
 * - 全角转半角，合并空白，保留标点与大小写
 */
function normalizeAnswerStrict(input) {
    if (input == null) return "";
    if (
        typeof window !== "undefined" &&
        window.PuzzleSecretVerifier &&
        typeof window.PuzzleSecretVerifier.normalizeAnswerStrict === "function"
    ) {
        return window.PuzzleSecretVerifier.normalizeAnswerStrict(input);
    }
    let str = String(input);
    str = str.replace(/[\u3000\uFF01-\uFF5E]/g, (ch) => {
        const code = ch.charCodeAt(0);
        return code === 0x3000 ? " " : String.fromCharCode(code - 0xfee0);
    });
    // 多个空白合并为一个空格，去除首尾空白
    return str.replace(/\s+/g, " ").trim();
}

/**
 * Vue3 组合式函数：可复用的答案规范化逻辑
 * 支持在 loose / strict 模式之间动态切换
 */
export function useAnswerNormalizer(initialMode = "loose") {
    const mode = ref(initialMode);

    /**
     * 根据当前模式规范化输入
     * @param {*} input 用户原始输入
     * @returns {string} 规范化后的字符串
     */
    function normalize(input) {
        if (mode.value === "strict") {
            return normalizeAnswerStrict(input);
        }
        return normalizeAnswerLoose(input);
    }

    /**
     * 切换模式
     * @param {'loose'|'strict'} newMode
     */
    function setMode(newMode) {
        if (newMode === "loose" || newMode === "strict") {
            mode.value = newMode;
        }
    }

    // 暴露只读模式，避免外部直接修改
    return {
        mode: readonly(mode),
        setMode,
        normalize,
    };
}

// 同时导出纯函数，方便在非组件上下文中直接使用
export { normalizeAnswerLoose, normalizeAnswerStrict };
