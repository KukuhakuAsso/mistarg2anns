<script setup>
// 名称查重结果提示（用户名 / 队名共用）：只负责展示，判定与文案由 useNameAvailability 提供。
defineProps({
  status: { type: String, required: true },
  message: { type: String, default: "" },
  id: { type: String, default: undefined },
});
</script>

<template>
  <!--
    常驻节点（不用 v-if）：live region 必须在文案出现前就存在于 DOM 中，
    否则首条提示往往不会被读屏播报；无文案时用 .is-empty 折叠占位。
  -->
  <small
    :id="id"
    class="name-status"
    :class="[`is-${status}`, { 'is-empty': !message }]"
    role="status"
  >
    {{ message }}
  </small>
</template>

<style scoped>
/* 查重结果配色：沿用原用户名提示的亮度，且不随主题变化（两种主题同一组颜色）。 */

.name-status {
  display: block;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
}

.name-status.is-empty {
  display: none;
}

.name-status.is-available {
  color: #6ce39b;
}

.name-status.is-taken,
.name-status.is-invalid {
  color: #ff8a80;
}

.name-status.is-checking,
.name-status.is-unchanged {
  color: #ffd166;
}
</style>
