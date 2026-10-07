<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { authApi } from "@/api/auth";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";

const emit = defineEmits(["close"]);
const { state } = useGameState();

const step = ref("request");
const form = ref({
  type: "email",
  identifier: "",
  captchaResponse: "",
  token: "",
  new_password: "",
  confirm_password: "",
});
const submitting = ref(false);
const message = ref("");
const messageType = ref("info");
const registrationConfig = ref({
  captcha: {
    enabled: false,
    ready: false,
    mode: "turnstile",
    site_key: "",
    script: "",
    test_hosts: [],
    test_ticket_required: false,
    widget: null,
  },
});
const captchaContainer = ref(null);
const turnstileWidgetId = ref(null);

const isLoggedIn = computed(() => Boolean(state.user.currentUser));

function resetMessage(type = "info", text = "") {
  messageType.value = type;
  message.value = text;
}

function loadTurnstileScript(scriptUrl) {
  if (!scriptUrl) {
    return Promise.resolve();
  }

  const existingScript = document.querySelector(`script[data-turnstile-script="${scriptUrl}"]`);
  if (existingScript) {
    if (window.turnstile) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-turnstile-script", scriptUrl);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed to load."));
    document.head.appendChild(script);
  });
}

function renderTurnstileWidget() {
  const captcha = registrationConfig.value.captcha;
  const widget = captcha?.widget;
  const params = widget?.params || {};
  const siteKey = params.site_key || captcha?.site_key;

  if (!captcha?.enabled || !captcha?.ready || !widget || !captchaContainer.value || !window.turnstile || !siteKey) {
    return;
  }

  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore removal errors
    }
  }

  turnstileWidgetId.value = window.turnstile.render(captchaContainer.value, {
    sitekey: siteKey,
    ...(params && typeof params === "object" ? params : {}),
    callback: (response) => {
      form.value.captchaResponse = response || "";
    },
    "expired-callback": () => {
      form.value.captchaResponse = "";
    },
    "error-callback": () => {
      form.value.captchaResponse = "";
    },
  });
}

async function loadRegistrationConfig() {
  try {
    const payload = await authApi.getRegistrationConfig();
    registrationConfig.value = {
      ...registrationConfig.value,
      ...(payload?.data || payload || {}),
    };

    const captcha = registrationConfig.value.captcha;
    if (captcha?.enabled && captcha?.ready && captcha?.widget) {
      if (captcha.widget.driver === "turnstile" && captcha.widget.params?.site_key && captcha.script) {
        await loadTurnstileScript(captcha.script);
        window.setTimeout(() => {
          renderTurnstileWidget();
        }, 0);
      }
    }
  } catch (error) {
    registrationConfig.value.captcha.enabled = false;
    registrationConfig.value.captcha.ready = false;
    resetMessage("error", "安全验证配置暂不可用，请稍后再试。");
  }
}

onMounted(async () => {
  await loadRegistrationConfig();
});

onBeforeUnmount(() => {
  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore removal errors
    }
  }
  turnstileWidgetId.value = null;
});

function validateRequestForm() {
  const identifier = String(form.value.identifier ?? "").trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!identifier) {
    return "请输入邮箱。";
  }

  if (!emailPattern.test(identifier)) {
    return "请输入有效的邮箱地址。";
  }

  const captcha = registrationConfig.value.captcha;
  if (captcha?.enabled && captcha?.ready && !form.value.captchaResponse) {
    return "请完成人机验证。";
  }

  return "";
}

function validateResetForm() {
  const token = String(form.value.token ?? "").trim();
  const newPassword = String(form.value.new_password ?? "").trim();
  const confirmPassword = String(form.value.confirm_password ?? "").trim();

  if (!token) {
    return "请输入邮件中的重置令牌。";
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

async function submitForgotRequest() {
  const validationError = validateRequestForm();
  if (validationError) {
    resetMessage("error", validationError);
    return;
  }

  submitting.value = true;
  resetMessage("info", "正在发送重置邮件...");

  try {
    const email = String(form.value.identifier ?? "").trim();

    await authApi.forgotPassword({
      type: "email",
      identifier: email,
      captcha: { response: String(form.value.captchaResponse ?? "").trim() },
      dev_ticket: import.meta.env.VITE_DEV_TICKET || "",
    });

    resetMessage(
      "success",
      "若该账号存在，我们已发送重置邮件。请在下一步中填写邮件中的令牌并设置新密码。",
    );
    step.value = "reset";
  } catch (error) {
    const payload = error?.payload ?? {};
    const code = payload?.code || payload?.error?.code || error?.code || "";

    if (code === "E_VALIDATION") {
      resetMessage("error", "找回密码请求格式不正确。请检查邮箱与验证信息。");
      return;
    }

    resetMessage("error", error?.message || "发送重置邮件失败，请稍后再试。");
  } finally {
    submitting.value = false;
  }
}

async function submitResetPassword() {
  const validationError = validateResetForm();
  if (validationError) {
    resetMessage("error", validationError);
    return;
  }

  submitting.value = true;
  resetMessage("info", "正在重置密码...");

  try {
    await authApi.resetPassword({
      token: String(form.value.token ?? "").trim(),
      new_password: String(form.value.new_password ?? "").trim(),
    });

    resetMessage("success", "密码已重置成功。其他会话已失效，请重新登录。");
    form.value = {
      type: "email",
      identifier: "",
      captchaResponse: "",
      token: "",
      new_password: "",
      confirm_password: "",
    };

    window.setTimeout(() => {
      if (isLoggedIn.value) {
        state.user.currentUser = null;
      }
      router.goToRoute("/register");
    }, 800);
  } catch (error) {
    const payload = error?.payload ?? {};
    const code = payload?.code || payload?.error?.code || error?.code || "";

    if (code === "E_AUTH") {
      resetMessage("error", "重置令牌无效或已过期，请重新获取邮件链接。");
    } else if (code === "E_VALIDATION") {
      resetMessage("error", "新密码格式不正确，至少 8 位字符。");
    } else {
      resetMessage("error", error?.message || "密码重置失败，请稍后再试。");
    }
  } finally {
    submitting.value = false;
  }
}

function goBackToLogin() {
  router.goToRoute("/register");
}

function goBackToRequest() {
  step.value = "request";
  resetMessage("info", "可以重新填写邮箱并发送重置邮件。");
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">账户</p>
        <h1>找回密码</h1>
      </div>
      <button class="secondary-button" type="button" @click="goBackToLogin">
        返回登录
      </button>
    </header>

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <p class="panel-card__label">{{ step === "request" ? "发送重置邮件" : "设置新密码" }}</p>

        <div v-if="step === 'request'" class="password-form">
          <label class="field">
            <span>邮箱</span>
            <input
              v-model="form.identifier"
              type="email"
              placeholder="请输入邮箱地址"
              autocomplete="email"
            />
          </label>

          <div v-if="registrationConfig.captcha?.enabled" class="field field--captcha">
            <span>人机验证</span>
            <div ref="captchaContainer" class="turnstile-wrap"></div>
          </div>

          <div v-if="message" :class="['status-box', `status-box--${messageType}`]">
            {{ message }}
          </div>

          <button
            class="primary-button"
            type="button"
            :disabled="submitting"
            @click="submitForgotRequest"
          >
            {{ submitting ? "发送中..." : "发送重置邮件" }}
          </button>
        </div>

        <div v-else class="password-form">
          <label class="field">
            <span>重置令牌</span>
            <input
              v-model="form.token"
              type="text"
              placeholder="请输入邮件中的 token"
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

          <div v-if="message" :class="['status-box', `status-box--${messageType}`]">
            {{ message }}
          </div>

          <div class="inline-actions">
            <button class="secondary-button" type="button" @click="goBackToRequest">
              重新发送
            </button>
            <button
              class="primary-button"
              type="button"
              :disabled="submitting"
              @click="submitResetPassword"
            >
              {{ submitting ? "重置中..." : "确认重置" }}
            </button>
          </div>
        </div>
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
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.field input:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
  background: rgba(18, 24, 36, 0.14);
}

.field--captcha {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

.turnstile-wrap {
  min-height: 60px;
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
  transition: filter 0.2s ease, opacity 0.2s ease, border-color 0.2s ease;
}

.primary-button {
  background: linear-gradient(135deg, var(--accent), var(--accent-soft));
  border-color: var(--border-strong);
  color: var(--surface);
}

.secondary-button {
  width: fit-content;
}

.primary-button:disabled {
  opacity: 0.7;
  cursor: wait;
}

.inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 680px) {
  .inline-actions {
    flex-direction: column;
  }

  .secondary-button,
  .primary-button {
    width: 100%;
  }
}
</style>
