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
  gap: 20px;
  border-bottom: 1px solid var(--border);
}

.user-tabs__btn {
  position: relative;
  padding: 8px 2px 10px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.18s ease;
}

/* 当前页标记：压在分隔线上的粗线。 */
.user-tabs__btn::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.18s ease;
}

.user-tabs__btn:hover:not(:disabled):not(.is-active) {
  color: var(--text);
}

.user-tabs__btn.is-active {
  color: var(--text);
  font-weight: 600;
}

.user-tabs__btn.is-active::after {
  opacity: 1;
}

.user-tabs__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
