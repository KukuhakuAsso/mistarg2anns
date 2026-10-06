<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";
import { authApi } from "@/api/auth";

const { state, registerUser, completeLoginAfterVerification } = useGameState();
const verificationCode = ref("");
const verificationMessage = ref("");

const verificationMode = computed(() => state.user.auth.verificationMode || "login");
const verificationTarget = computed(() => {
  if (verificationMode.value === "register") {
    return state.user.auth.pendingRegister?.email || "邮箱";
  }

  return state.user.auth.pendingLogin?.username || "账户";
});

const hasValidVerificationState = computed(() => {
  if (!state.user.auth.verificationRequired) {
    return false;
  }

  if (verificationMode.value === "register") {
    return Boolean(state.user.auth.pendingRegister);
  }

  return Boolean(state.user.auth.pendingLogin);
});

function enforceVerificationGuard() {
  if (!hasValidVerificationState.value) {
    verificationMessage.value = "无效的验证状态，已返回登录页。";
    router.goToRoute("/register");
    return false;
  }

  return true;
}

onMounted(() => {
  enforceVerificationGuard();
});

watch(
  () => [
    state.user.auth.verificationRequired,
    state.user.auth.verificationMode,
    state.user.auth.pendingRegister,
    state.user.auth.pendingLogin,
  ],
  () => {
    if (!hasValidVerificationState.value) {
      router.goToRoute("/register");
    }
  },
  { deep: true },
);

function getGeneratedCode() {
  return String(state.user.auth.generatedCode ?? "");
}

async function resendVerificationCode() {
  if (verificationMode.value !== "register") {
    const generated = String(Math.floor(100000 + Math.random() * 900000));
    state.user.auth.generatedCode = generated;
    verificationMessage.value = `验证码已重新发送至 ${verificationTarget.value}，验证码为 ${generated}（演示环境）。`;
    return;
  }

  const pendingRegister = state.user.auth.pendingRegister;
  if (!pendingRegister) {
    verificationMessage.value = "注册信息已失效，请重新注册。";
    return;
  }

  try {
    const payload = {
      email: pendingRegister.email,
      username: pendingRegister.username,
      ...(import.meta.env.VITE_DEV_TICKET ? { dev_ticket: import.meta.env.VITE_DEV_TICKET } : {}),
      ...(window.__captchaResponse ? { captcha: { response: window.__captchaResponse } } : {}),
    };

    await authApi.sendVerificationCode(payload);
    verificationMessage.value = `验证码已重新发送至 ${pendingRegister.email}。`;
  } catch (error) {
    verificationMessage.value = error?.payload?.error?.message || error?.payload?.message || error?.message || "验证码重发失败。";
  }
}

function goBackToAuth() {
  state.user.auth.verificationRequired = false;
  state.user.auth.verificationMode = "login";
  state.user.auth.pendingRegister = null;
  state.user.auth.pendingLogin = null;
  state.user.auth.generatedCode = "";
  verificationCode.value = "";
  verificationMessage.value = "";
  router.goToRoute("/register");
}

async function completeVerification() {
  const enteredCode = String(verificationCode.value ?? "").trim();

  if (!enteredCode) {
    verificationMessage.value = "验证码不能为空。";
    return;
  }

  if (verificationMode.value === "register") {
    try {
      const response = await authApi.verifyVerificationCode({
        email: state.user.auth.pendingRegister?.email,
        code: enteredCode,
      });

      if (!response?.ok && response?.data?.ok === false) {
        verificationMessage.value = response?.data?.message || "验证码错误，请重新输入。";
        return;
      }

      const account = response?.data?.account || response?.account;
      if (account) {
        state.user.currentUser = {
          id: account.id,
          username: account.username,
          nickname: account.username,
          email: state.user.auth.pendingRegister?.email || "",
          player_no: account.player_no || "",
          role: account.role || "player",
          team: account.team || null,
        };

        const existingUserIndex = state.user.users.findIndex(
          (user) => String(user.email ?? "").toLowerCase() === String(state.user.auth.pendingRegister?.email ?? "").toLowerCase(),
        );

        if (existingUserIndex >= 0) {
          state.user.users[existingUserIndex] = {
            ...state.user.users[existingUserIndex],
            username: account.username,
            nickname: account.username,
            email: state.user.auth.pendingRegister?.email || state.user.users[existingUserIndex].email,
            password: state.user.users[existingUserIndex].password || "",
          };
        } else {
          state.user.users.push({
            username: account.username,
            nickname: account.username,
            email: state.user.auth.pendingRegister?.email || "",
            password: "",
          });
        }
      }
    } catch (error) {
      verificationMessage.value = error?.payload?.error?.message || error?.payload?.message || error?.message || "验证码校验失败。";
      return;
    }
  } else {
    if (enteredCode !== getGeneratedCode()) {
      verificationMessage.value = "验证码错误，请重新输入。";
      return;
    }
  }

  if (verificationMode.value === "register") {
    const pendingRegister = state.user.auth.pendingRegister;

    if (!pendingRegister) {
      verificationMessage.value = "注册信息已失效，请重新注册。";
      return;
    }

    const result = registerUser({
      username: pendingRegister.username,
      email: pendingRegister.email,
      password: pendingRegister.password,
    });

    verificationMessage.value = result.message;
    if (result.ok) {
      state.user.auth.verificationRequired = false;
      state.user.auth.verificationMode = "login";
      state.user.auth.pendingRegister = null;
      state.user.auth.pendingLogin = null;
      state.user.auth.generatedCode = "";
      verificationCode.value = "";
      router.goToRoute("/register");
    }
    return;
  }

  const pendingLogin = state.user.auth.pendingLogin;

  if (!pendingLogin) {
    verificationMessage.value = "登录验证信息已失效，请重新登录。";
    return;
  }

  const result = completeLoginAfterVerification(
    pendingLogin.username,
    pendingLogin.password,
  );

  verificationMessage.value = result.message;
  if (result.ok) {
    state.user.auth.verificationRequired = false;
    state.user.auth.verificationMode = "login";
    state.user.auth.pendingRegister = null;
    state.user.auth.pendingLogin = null;
    state.user.auth.generatedCode = "";
    verificationCode.value = "";
    router.goToRoute("/register");
  }
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">安全验证</p>
        <h1>{{ verificationMode === "register" ? "邮箱验证" : "账号验证" }}</h1>
      </div>
    </header>

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <p class="panel-card__label">验证码</p>
        <h2>请输入验证码</h2>
        <p class="verification-help">
          验证码已发送到 <strong>{{ verificationTarget }}</strong>
        </p>

        <label class="verification-field">
          <span>验证码</span>
          <input v-model="verificationCode" type="text" maxlength="6" placeholder="请输入 6 位验证码" />
        </label>

        <div class="verification-actions">
          <button class="secondary-button" type="button" @click="resendVerificationCode">
            重新发送
          </button>
          <button class="primary-button" type="button" @click="goBackToAuth">
             返回登录 / 注册
          </button>
        </div>
        
        <button class="ghost-button" type="button" @click="completeVerification">
            {{ verificationMode === "register" ? "完成注册" : "验证并登录" }}
        </button>

        <p v-if="verificationMessage" class="helper-text">{{ verificationMessage }}</p>
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

.panel-card h2 {
  margin: 0;
  font-size: 24px;
}

.verification-help {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.6;
}

.verification-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.verification-field input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(8, 13, 20, 0.12);
  color: var(--text);
  box-sizing: border-box;
}

.verification-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.primary-button,
.secondary-button,
.ghost-button {
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
}

.secondary-button {
  width: fit-content;
}

.ghost-button {
  background: transparent;
}

.helper-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
}
</style>
