<script setup>
// 设置栏：只放功能性按钮与进度读数，不承载内容展示。
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useGameState } from "@/composables/useGameState";
import { useTheme } from "@/composables/useTheme";
import { FOLDERS, MAIN_FOLDERS } from "@/config/folders";
import {
  apiConfig,
  apiEnvironment,
  setApiEnvironment,
} from "@/config/api";

defineProps({
  inFolder: { type: Boolean, default: false },
});

const emit = defineEmits(["go-desktop"]);

const { state, unlockedCount, completedCount, toggleCluePanel, resetProgress } =
  useGameState();
const { themeIcon, themeLabel, cycleTheme } = useTheme();
const isTestEnvironment = computed(() => apiEnvironment.value === "test");
const testEnvironmentAvailable = Boolean(apiConfig.testTicket);

function handleReset() {
  const confirmed = window.confirm(
    "确定要重置进度吗？已解锁的档案与线索板排布都会被清空。",
  );
  if (confirmed) resetProgress();
}

function toggleApiEnvironment() {
  setApiEnvironment(isTestEnvironment.value ? "production" : "test");
}
</script>

<template>
  <header class="top-bar">
    <div class="top-bar__group">
      <button
        class="bar-btn"
        type="button"
        :disabled="!inFolder"
        title="返回主界面"
        @click="emit('go-desktop')"
      >
        <AppIcon name="back" />
        <span>桌面</span>
      </button>
      <button
        class="bar-btn"
        type="button"
        :class="{ 'is-active': state.ui.cluePanelOpen }"
        title="显示 / 隐藏线索栏"
        @click="toggleCluePanel()"
      >
        <AppIcon name="board" />
        <span>线索栏</span>
      </button>
    </div>

    <div class="top-bar__title">
      <span class="top-bar__name">mistarg2anns</span>
      <span class="top-bar__dim">// 档案终端</span>
    </div>

    <div class="top-bar__group">
      <span class="top-bar__stat">
        解锁 {{ unlockedCount }}/{{ FOLDERS.length }} · 完成
        {{ completedCount }}/{{ MAIN_FOLDERS.length }}
      </span>
      <span class="top-bar__stat">Tips 点 {{ state.tipPoints }}</span>
      <button
        class="bar-btn"
        :class="{ 'is-active': isTestEnvironment }"
        type="button"
        role="switch"
        :aria-checked="isTestEnvironment"
        :disabled="!testEnvironmentAvailable"
        :title="
          testEnvironmentAvailable
            ? `切换到${isTestEnvironment ? '正式' : '测试'}环境请求头`
            : '未配置测试票据，无法启用测试环境'
        "
        @click="toggleApiEnvironment"
      >
        <span>{{ isTestEnvironment ? "测试环境" : "正式环境" }}</span>
      </button>
      <button
        class="bar-btn"
        type="button"
        title="切换主题（跟随系统 / 浅色 / 深色）"
        @click="cycleTheme()"
      >
        <AppIcon :name="themeIcon" />
        <span>{{ themeLabel }}</span>
      </button>
      <button
        class="bar-btn bar-btn--danger"
        type="button"
        title="清空进度与线索板"
        @click="handleReset()"
      >
        <AppIcon name="reset" />
        <span>重置</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--bar-h);
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.top-bar__group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.top-bar__title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-family: var(--mono);
  font-size: 12px;
}

.top-bar__name {
  letter-spacing: 0.04em;
  color: var(--text);
}

.top-bar__dim {
  color: var(--text-dim);
}

.top-bar__stat {
  margin-right: 6px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}

@media (max-width: 860px) {
  .top-bar__title {
    display: none;
  }

  .top-bar__stat {
    display: none;
  }
}
</style>
