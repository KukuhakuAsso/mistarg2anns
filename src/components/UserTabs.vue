<script setup>
// 用户区四个页面（队伍 / 注册 / 站内信 / 里程碑）之间的导航标签，
// 各页自行引入即可，当前页由路由名判定。
import { computed } from "vue";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";
import { USER_TABS } from "@/config/desktop";

const { state } = useGameState();

// 当前所在页面；tab 的 id 与路由名一致。
const activeId = computed(() => router.currentRoute.name);
const isLoggedIn = computed(() => Boolean(state.user.currentUser));

// 除「注册」外都要求登录：未登录时禁用，避免被访问守卫静默弹回注册页。
function isDisabled(tab) {
  return tab.id !== "register" && !isLoggedIn.value;
}

function openTab(tab) {
  if (isDisabled(tab) || activeId.value === tab.id) {
    return;
  }

  router.goToRoute(`/${tab.id}`);
}
</script>

<template>
  <nav class="user-tabs" aria-label="用户功能导航">
    <button
      v-for="tab in USER_TABS"
      :key="tab.id"
      class="user-tabs__btn"
      :class="{ 'is-active': activeId === tab.id }"
      type="button"
      :disabled="isDisabled(tab)"
      :title="isDisabled(tab) ? '请先登录' : tab.name"
      @click="openTab(tab)"
    >
      {{ tab.name }}
    </button>
  </nav>
</template>

<style scoped>
.user-tabs {
  display: flex;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.user-tabs__btn {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease;
}

.user-tabs__btn:hover:not(:disabled):not(.is-active) {
  color: var(--text);
}

.user-tabs__btn.is-active {
  border-color: var(--border-strong);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.user-tabs__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
