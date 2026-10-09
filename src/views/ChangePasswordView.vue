<script setup>
import { computed, ref } from "vue";
import { authApi } from "@/api/auth";
import { clearAccessToken } from "@/api/request";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";

const emit = defineEmits(["close"]);
const { state } = useGameState();

const form = ref({
  old_password: "",
  new_password: "",
  confirm_password: "",
});
const submitting = ref(false);
const message = ref("");
const messageType = ref("info");

const hasLoggedInUser = computed(() => Boolean(state.user.currentUser));

function validateForm() {
  const oldPassword = String(form.value.old_password ?? "").trim();
  const newPassword = String(form.value.new_password ?? "").trim();
  const confirmPassword = String(form.value.confirm_password ?? "").trim();

  if (!oldPassword) {
    return "请输入当前密码。";
  }

  if (!newPassword) {
    return "请输入新密码。";
  }

  if (newPassword.length < 8) {
    return "新密码至少需要 8 位字符。";
  }

  if (newPassword !== confirmPassword) {
    return "两次输入的新密码不一致。";
  }

  return "";
}

async function submitChangePassword() {
  const validationError = validateForm();
  if (validationError) {
    message.value = validationError;
    messageType.value = "error";
    return;
  }

  submitting.value = true;
  message.value = "正在更新密码，请稍候...";
  messageType.value = "info";

  try {
    await authApi.changePassword({
      old_password: String(form.value.old_password ?? "").trim(),
      new_password: String(form.value.new_password ?? "").trim(),
    });

    message.value = "密码修改成功，当前会话已失效，请重新登录。";
    messageType.value = "success";
    clearAccessToken();
    state.user.currentUser = null;

    window.setTimeout(() => {
      router.goToRoute("/register");
    }, 800);
  } catch (error) {
    const payload = error?.payload ?? {};
    const code = payload?.code || payload?.error?.code || error?.code || "";
    const detail = payload?.detail ?? payload?.error?.detail ?? {};

    if (code === "E_VALIDATION") {
      message.value = "新密码格式不正确，至少 8 位字符。";
    } else if (code === "E_AUTH") {
      message.value = detail?.reason || "原密码不正确。";
    } else {
      message.value = error?.message || "密码修改失败，请稍后再试。";
    }

    messageType.value = "error";
  } finally {
    submitting.value = false;
  }
}

function closeView() {
  if (state.user.currentUser) {
    router.goToRoute("/register");
    return;
  }

  emit("close");
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">账户</p>
        <h1>修改密码</h1>
      </div>
      <button class="secondary-button" type="button" @click="closeView">
        返回
      </button>
    </header>

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <p v-if="!hasLoggedInUser" class="panel-card__label">
          当前未登录，无法修改密码。
        </p>

        <template v-else>
          <p class="panel-card__label">修改当前账号密码</p>

          <div class="password-form">
            <label class="field">
              <span>当前密码</span>
              <input
                v-model="form.old_password"
                type="password"
                placeholder="请输入当前密码"
                autocomplete="current-password"
              />
            </label>

            <label class="field">
              <span>新密码</span>
              <input
                v-model="form.new_password"
                type="password"
                placeholder="至少 8 位"
                autocomplete="new-password"
              />
            </label>

            <label class="field">
              <span>确认新密码</span>
              <input
                v-model="form.confirm_password"
                type="password"
                placeholder="再次输入新密码"
                autocomplete="new-password"
              />
            </label>

            <div
              v-if="message"
              :class="['status-box', `status-box--${messageType}`]"
            >
              {{ message }}
            </div>

            <button
              class="primary-button"
              type="button"
              :disabled="submitting"
              @click="submitChangePassword"
            >
              {{ submitting ? "修改中，请稍候..." : "确认修改" }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.page-shell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.page-shell__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-shell__title h1 {
  margin: 0;
  font-size: 28px;
}

.page-shell__eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.page-shell__body {
  display: flex;
  justify-content: center;
}

.panel-card {
  width: min(560px, 100%);
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.panel-card--wide {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-card__label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.password-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.field input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(8, 13, 20, 0.12);
  color: var(--text);
  box-sizing: border-box;
  font: inherit;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.field input:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
  background: rgba(18, 24, 36, 0.14);
}

.status-box {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}

.status-box--info {
  background: rgba(95, 124, 255, 0.08);
  border: 1px solid rgba(95, 124, 255, 0.25);
  color: var(--text);
}

.status-box--success {
  background: rgba(61, 200, 128, 0.08);
  border: 1px solid rgba(61, 200, 128, 0.3);
  color: #7fe0a8;
}

.status-box--error {
  background: rgba(255, 93, 93, 0.08);
  border: 1px solid rgba(255, 93, 93, 0.25);
  color: #ff9f9f;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
  transition:
    filter 0.2s ease,
    opacity 0.2s ease,
    border-color 0.2s ease;
}

.primary-button {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--text);
}

.secondary-button {
  width: fit-content;
}

.primary-button:disabled {
  opacity: 0.7;
  cursor: wait;
}

.current-user-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
