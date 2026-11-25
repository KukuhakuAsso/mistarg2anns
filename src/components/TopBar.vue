<script setup>
// 设置栏：只放功能性按钮与进度读数，不承载内容展示。
import { computed, watch } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useGameState } from "@/composables/useGameState";
import { usePuzzleMap } from "@/composables/usePuzzleMap";
import { useTheme } from "@/composables/useTheme";
import { apiConfig, apiEnvironment, setApiEnvironment } from "@/config/api";

defineProps({
  inFolder: { type: Boolean, default: false },
});

const emit = defineEmits(["go-desktop"]);

const { state, toggleCluePanel, resetProgress } = useGameState();
const { progress, loaded: mapLoaded, error: mapError } = usePuzzleMap();
const { themeIcon, themeLabel, cycleTheme } = useTheme();
const isTestEnvironment = computed(() => apiEnvironment.value === "test");
const testEnvironmentAvailable = Boolean(apiConfig.testTicket);

// 线索栏的内容是账号级记录，但只有进入游戏（题目结构拉取成功）后才可读：
// 未入队 / 未确认参赛 / 未开赛时 map 会报门禁错误，此时卡片既没有标题封面也没有操作意义。
// 所以按钮在「未进入游戏」时保持关闭态且不可点击 —— 与桌面上那条 map 报错同源判定。
const isLoggedIn = computed(() => Boolean(state.user.currentUser));
const canUseClueBoard = computed(
  () => isLoggedIn.value && mapLoaded.value && !mapError.value,
);
const clueBoardTitle = computed(() => {
  if (!isLoggedIn.value) return "登录后才能打开线索栏";
  if (mapError.value) return `比赛开始后才能打开线索栏：${mapError.value}`;
  if (!mapLoaded.value) return "正在读取题目结构…";
  return "显示 / 隐藏线索栏";
});

// 还没进入游戏（map 报门禁错误：未入队 / 未确认参赛 / 未开赛 / 被封禁）时，
// 线索栏没有意义：按钮保持关闭态且不可点。若上次登录时它是展开的，
// 这里一并收起，避免出现「按钮显示关闭、右侧却还挂着线索栏」。
watch(
  () => isLoggedIn.value && Boolean(mapError.value),
  (blocked) => {
    if (blocked && state.ui.cluePanelOpen) toggleCluePanel();
  },
  { immediate: true },
);

// 右上角的 tips 是本队共享余额（服务端权威数据）：无队伍时提示加入队伍后开始累积，
// 未加载时先用占位符，避免先显示一个假的 0。
const teamTipsText = computed(() => {
  const tips = state.teamTips;
  if (!tips.loaded) {
    return "Tips —";
  }
  return tips.hasTeam ? `Tips ${tips.balance}` : "Tips 未入队";
});

const teamTipsTitle = computed(() => {
  const tips = state.teamTips;
  if (!tips.loaded) {
    return "正在读取本队 tips…";
  }
  if (!tips.hasTeam) {
    return "tips 是队伍级的：加入队伍后开始累积";
  }
  return tips.today
    ? `本队共享 tips；今日已累积 ${tips.today.accrued}/${tips.today.cap}`
    : "本队共享 tips";
});

function handleReset() {
  const confirmed = window.confirm(
    "确定要清空本地记录吗？线索板排布与浏览标记会被清空；解题进度由服务端保存，不受影响。",
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
        :class="{ 'is-active': canUseClueBoard && state.ui.cluePanelOpen }"
        :disabled="!canUseClueBoard"
        :title="clueBoardTitle"
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
      <span class="top-bar__stat" title="已解出题数 / 当前可见题数">
        解出 {{ progress.solvedCount }}/{{ progress.totalPuzzles }}
      </span>
      <span class="top-bar__stat" :title="teamTipsTitle">
        {{ teamTipsText }}
      </span>
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
        title="清空本地记录与线索板"
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
