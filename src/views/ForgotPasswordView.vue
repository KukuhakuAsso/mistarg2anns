<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { authApi } from "@/api/auth";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";

const { state } = useGameState();

// 当前步骤：request = 填邮箱发送重置邮件，reset = 填令牌并设置新密码。
const step = ref("request");
// 表单数据，包括邮箱、验证码、重置令牌和新密码等字段。
const form = ref({
  type: "email",
  identifier: "",
  captchaResponse: "",
  token: "",
  new_password: "",
  confirm_password: "",
});
// 提交状态与提示信息。
const submitting = ref(false);
const message = ref("");
const messageType = ref("info");
// 注册配置，包括验证码相关设置。
const registrationConfig = ref({
  code_ttl_minutes: 10,
  resend_cooldown_sec: 60,
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
// 人机验证相关的 DOM 容器、组件 ID 及重发倒计时等状态。
const captchaContainer = ref(null);
const turnstileWidgetId = ref(null);
const resendCooldownRemaining = ref(0);
let resendCooldownTimer = null;

// 是否处于登录态：重置成功后要顺带清掉本地用户，避免留在已失效的会话上。
const isLoggedIn = computed(() => Boolean(state.user.currentUser));
// 重置令牌有效期（分钟），取自后端配置；未下发或非法时按 10 分钟展示。
const resetTokenTtlMinutes = computed(() => {
  const ttlMinutes = Number(registrationConfig.value.code_ttl_minutes);
  return Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;
});
// 重置令牌有效期（分钟），取自后端配置；未下发或非法时按 10 分钟展示。
// 统一设置提示文案与样式类型（info / success / error）。
function resetMessage(type = "info", text = "") {
  messageType.value = type;
  message.value = text;
}

// 按需注入 Turnstile 脚本；已注入过则复用（脚本就绪直接返回，否则等它加载完）。
function loadTurnstileScript(scriptUrl) {
  if (!scriptUrl) {
    return Promise.resolve();
  }

  const existingScript = document.querySelector(
    `script[data-turnstile-script="${scriptUrl}"]`,
  );
  if (existingScript) {
    if (window.turnstile) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Turnstile script failed to load.")),
        { once: true },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-turnstile-script", scriptUrl);
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Turnstile script failed to load."));
    document.head.appendChild(script);
  });
}

// 在容器中渲染人机验证组件，回调把 token 写回表单；配置未就绪或缺容器/脚本时跳过。
function renderTurnstileWidget() {
  const captcha = registrationConfig.value.captcha;
  const widget = captcha?.widget;
  const params = widget?.params || {};
  const siteKey = params.site_key || captcha?.site_key;

  if (
    !captcha?.enabled ||
    !captcha?.ready ||
    !widget ||
    !captchaContainer.value ||
    !window.turnstile ||
    !siteKey
  ) {
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

// 拉取后端的安全验证配置，需要时加载脚本并渲染组件；失败则关掉人机验证并提示用户。
async function loadRegistrationConfig() {
  try {
    const payload = await authApi.getRegistrationConfig();
    registrationConfig.value = {
      ...registrationConfig.value,
      ...(payload?.data || payload || {}),
    };

    const captcha = registrationConfig.value.captcha;
    if (captcha?.enabled && captcha?.ready && captcha?.widget) {
      if (
        captcha.widget.driver === "turnstile" &&
        captcha.widget.params?.site_key &&
        captcha.script
      ) {
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

// 进入页面时先取到验证配置，之后才可能渲染出人机验证。
onMounted(async () => {
  await loadRegistrationConfig();
});

// 离开页面时销毁验证组件并清理倒计时，避免定时器残留。
onBeforeUnmount(() => {
  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore removal errors
    }
  }
  turnstileWidgetId.value = null;
  clearResendCooldown();
});

// 停止并归零重发倒计时。
function clearResendCooldown() {
  if (resendCooldownTimer !== null) {
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = null;
  }
  resendCooldownRemaining.value = 0;
}

// 按后端配置的冷却秒数启动重发倒计时；配置为 0 或非法时不启动。
function startResendCooldown() {
  clearResendCooldown();
  const cooldownSeconds = Math.max(
    0,
    Math.floor(Number(registrationConfig.value.resend_cooldown_sec) || 0),
  );

  if (!cooldownSeconds) {
    return;
  }

  resendCooldownRemaining.value = cooldownSeconds;
  resendCooldownTimer = window.setInterval(() => {
    resendCooldownRemaining.value -= 1;
    if (resendCooldownRemaining.value <= 0) {
      clearResendCooldown();
    }
  }, 1000);
}

// 校验第一步表单（邮箱格式 + 人机验证），返回错误文案；空串表示通过。
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

// 校验第二步表单（令牌非空、新密码 ≥ 8 位且两次一致），返回错误文案；空串表示通过。
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

// 第一步提交：请求发送重置邮件。成功即切到 reset 步骤并开始重发冷却。
async function submitForgotRequest() {
  if (resendCooldownRemaining.value > 0) {
    return;
  }
 
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
    startResendCooldown();
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

// 第二步提交：用令牌重置密码。成功后清空表单、清掉本地登录态并返回登录页。
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

// 返回登录 / 注册页。
function goBackToLogin() {
  router.goToRoute("/register");
}

// 退回第一步：清掉上一次的验证结果，并重建人机验证组件（旧组件已随 v-if 卸载）。
async function goBackToRequest() {
  form.value.captchaResponse = "";
  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore removal errors when the previous step has already unmounted the widget
    }
  }
  turnstileWidgetId.value = null;

  step.value = "request";
  resetMessage("info", "可以重新填写邮箱并发送重置邮件。");
  await nextTick();
  renderTurnstileWidget();
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
        <p class="panel-card__label">
          {{ step === "request" ? "发送重置邮件" : "设置新密码" }}
        </p>

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

          <div
            v-if="registrationConfig.captcha?.enabled"
            class="field field--captcha"
          >
            <span>人机验证</span>
            <div ref="captchaContainer" class="turnstile-wrap"></div>
          </div>

          <div
            v-if="message"
            :class="['status-box', `status-box--${messageType}`]"
          >
            {{ message }}
          </div>

          <button
            class="primary-button"
            type="button"
            :disabled="submitting || resendCooldownRemaining > 0"
            @click="submitForgotRequest"
          >
            {{
              submitting
                ? "发送中，请稍候..."
                : resendCooldownRemaining > 0
                  ? `${resendCooldownRemaining} 秒后可重发`
                  : "发送重置邮件"
            }}
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

          <p class="reset-help">
            重置令牌有效期为 {{ resetTokenTtlMinutes }} 分钟。
          </p>

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

          <div class="inline-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="submitting || resendCooldownRemaining > 0"
              @click="goBackToRequest"
            >
              {{
                resendCooldownRemaining > 0
                  ? `${resendCooldownRemaining} 秒后可重发`
                  : "重新发送"
              }}
            </button>
            <button
              class="primary-button"
              type="button"
              :disabled="submitting"
              @click="submitResetPassword"
            >
              {{ submitting ? "重置中，请稍候..." : "确认重置" }}
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
