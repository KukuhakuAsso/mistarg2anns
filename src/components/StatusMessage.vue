<script setup>
// 操作结果提示（各页面共用）：按语义上色，比普通说明文字更醒目。
// 配色与用户名 / 队名查重提示（NameStatus.vue）保持一致，且不随主题切换。
// 文案与语义色由 useStatusMessage 提供，这里只负责展示。
defineProps({
  message: { type: String, default: "" },
  tone: { type: String, default: "info" },
});
</script>

<template>
  <!--
    常驻节点（不用 v-if）：live region 必须在文案出现前就存在于 DOM 中，
    否则首条提示往往不会被读屏播报；无文案时用 .is-empty 折叠占位。
  -->
  <p
    class="status-message"
    :class="[`is-${tone}`, { 'is-empty': !message }]"
    role="status"
  >
    {{ message }}
  </p>
</template>

<style scoped>
.status-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}

.status-message.is-empty {
  display: none;
}

/* 说明 / 中性：文字沿用正文色，只靠底色与描边区分。 */
.status-message.is-info {
  border: 1px solid rgba(95, 124, 255, 0.25);
  background: rgba(95, 124, 255, 0.08);
  color: var(--text);
}

/* 进行中：与查重提示的「检查中」同为琥珀色。 */
.status-message.is-pending {
  border: 1px solid rgba(255, 209, 102, 0.4);
  background: rgba(255, 209, 102, 0.14);
  color: #ffd166;
}

.status-message.is-success {
  border: 1px solid rgba(108, 227, 155, 0.4);
  background: rgba(108, 227, 155, 0.14);
  color: #6ce39b;
}

.status-message.is-error {
  border: 1px solid rgba(255, 138, 128, 0.4);
  background: rgba(255, 138, 128, 0.14);
  color: #ff8a80;
}
</style>
