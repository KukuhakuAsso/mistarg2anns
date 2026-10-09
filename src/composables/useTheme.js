// 主题：跟随系统 / 浅色 / 深色 三态循环，结果写入 <html class="dark">。
// 主题选择保存在游戏状态里，与进度一起持久化。

import { computed, ref, watchEffect } from "vue";
import { useGameState } from "./useGameState";

const NEXT_THEME = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL = { system: "跟随系统", light: "浅色", dark: "深色" };
const THEME_ICON = { system: "monitor", light: "sun", dark: "moon" };

const prefersDark = ref(false);

if (typeof window !== "undefined" && window.matchMedia) {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    prefersDark.value = query.matches;
    query.addEventListener("change", (event) => {
        prefersDark.value = event.matches;
    });
}

export function useTheme() {
    const { state } = useGameState();
    console.log(state);
    const isDark = computed(
        () =>
            state.ui.theme === "dark" ||
            (state.ui.theme === "system" && prefersDark.value),
    );

    watchEffect(() => {
        document.documentElement.classList.toggle("dark", isDark.value);
    });

    function cycleTheme() {
        state.ui.theme = NEXT_THEME[state.ui.theme] ?? "system";
    }

    return {
        isDark,
        themeIcon: computed(() => THEME_ICON[state.ui.theme] ?? "monitor"),
        themeLabel: computed(() => THEME_LABEL[state.ui.theme] ?? ""),
        cycleTheme,
    };
}
