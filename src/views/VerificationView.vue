<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";
import { authApi } from "@/api/auth";

// 验证页逻辑：处理验证码输入、重发、以及人机验证挑战。
// 游戏总体状态，包括当前用户信息和待验证的注册载荷。
const { state } = useGameState();
// 验证码相关的响应式状态和配置。
const verificationCode = ref("");
const verificationMessage = ref("");
const resending = ref(false);
const verifying = ref(false);
// 是否有请求在途（重发或校验），用于禁用按钮、防止重复提交。
const requestPending = computed(() => resending.value || verifying.value);
// 重发验证码的配置，包括冷却时长和人机验证参数。
const resendCaptchaConfig = ref({
  code_length: 6,
  code_ttl_minutes: 10,
  resend_cooldown_sec: 60,
  captcha: {
    enabled: false,
    ready: false,
    script: "",
    widget: null,
  },
});
// 是否已成功加载过重发验证码的配置。
const resendCaptchaConfigLoaded = ref(false);
const showResendCaptcha = ref(false);
const resendCaptchaContainer = ref(null);
const resendCaptchaWidgetId = ref(null);
const resendCaptchaResponse = ref("");
const resendCooldownRemaining = ref(0);
let resendCooldownTimer = null;

// 验证码位数，取自后端配置；未下发或非法时按 6 位。
const verificationCodeLength = computed(() => {
  const codeLength = Number(resendCaptchaConfig.value.code_length);
  return Number.isInteger(codeLength) && codeLength > 0 ? codeLength : 6;
});
// 验证码有效期（分钟），仅用于页面提示；未下发或非法时按 10 分钟。
const verificationCodeTtlMinutes = computed(() => {
  const ttlMinutes = Number(resendCaptchaConfig.value.code_ttl_minutes);
  return Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;
});
// 注册验证流程的待验证载荷；由 RegisterView 在发码后写入，验证完成后清空。
const pendingRegistration = computed(() => state.user.pendingRegistration);
// 验证码收件邮箱，用于文案展示；载荷缺失时退化为占位词。
const verificationTarget = computed(() => pendingRegistration.value?.email || "邮箱");

// 校验当前是否处于有效的验证流程：没有待验证载荷就退回登录页，返回是否可继续。
function enforceVerificationGuard() {
  if (!pendingRegistration.value) {
    verificationMessage.value = "无效的验证状态，已返回登录页。";
    router.goToRoute("/register");
    return false;
  }

  return true;
}

// 先过守卫，再取一次配置以启动重发冷却（冷却时长由后端下发）。
onMounted(async () => {
  if (!enforceVerificationGuard()) {
    return;
  }

  if (await loadResendCaptchaConfig()) {
    startResendCooldown();
  }
});

// 离开页面时销毁人机验证组件并停掉冷却定时器。
onBeforeUnmount(() => {
  resetResendCaptcha();
  clearResendCooldown();
});

// 待验证载荷一旦被清空（例如别处复位了注册流程），立刻退回登录页。
watch(
  () => state.user.pendingRegistration,
  () => {
    if (!pendingRegistration.value) {
      router.goToRoute("/register");
    }
  },
);

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
    script.onerror = () => reject(new Error("Turnstile script failed to load."));
    document.head.appendChild(script);
  });
}

// 拉取注册配置（重发冷却时长 + 人机验证参数）；已成功加载过则直接复用，不重复请求。
async function loadResendCaptchaConfig() {
  if (resendCaptchaConfigLoaded.value) {
    return true;
  }

  try {
    const payload = await authApi.getRegistrationConfig();
    resendCaptchaConfig.value = {
      ...resendCaptchaConfig.value,
      ...(payload?.data || payload || {}),
    };
    resendCaptchaConfigLoaded.value = true;
    return true;
  } catch (error) {
    verificationMessage.value = "注册验证配置暂不可用，请稍后再试。";
    return false;
  }
}

// 停止重发冷却倒计时并归零。
function clearResendCooldown() {
  if (resendCooldownTimer !== null) {
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = null;
  }
  resendCooldownRemaining.value = 0;
}

// 按配置的冷却秒数启动重发倒计时；为 0 或非法时不启动。
function startResendCooldown() {
  clearResendCooldown();
  const cooldownSeconds = Math.max(
    0,
    Math.floor(Number(resendCaptchaConfig.value.resend_cooldown_sec) || 0),
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

// 清空人机验证结果、销毁组件，并收起验证区域。
function resetResendCaptcha() {
  resendCaptchaResponse.value = "";
  if (resendCaptchaWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(resendCaptchaWidgetId.value);
    } catch (error) {
      // ignore removal errors when the widget has already been unmounted
    }
  }
  resendCaptchaWidgetId.value = null;
  showResendCaptcha.value = false;
}

// 在重发区域渲染人机验证，回调把 token 写回 resendCaptchaResponse；
// 配置未就绪或缺容器 / 脚本时跳过。
function renderResendCaptcha() {
  const captcha = resendCaptchaConfig.value.captcha;
  const widget = captcha?.widget;
  const params = widget?.params || {};
  const siteKey = params.site_key || captcha?.site_key;

  if (
    !captcha?.enabled ||
    !captcha?.ready ||
    !widget ||
    !resendCaptchaContainer.value ||
    !window.turnstile ||
    !siteKey
  ) {
    return;
  }

  if (resendCaptchaWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(resendCaptchaWidgetId.value);
    } catch (error) {
      // ignore removal errors and render a new challenge
    }
  }

  resendCaptchaWidgetId.value = window.turnstile.render(resendCaptchaContainer.value, {
    sitekey: siteKey,
    ...(params && typeof params === "object" ? params : {}),
    callback: (response) => {
      resendCaptchaResponse.value = response || "";
    },
    "expired-callback": () => {
      resendCaptchaResponse.value = "";
    },
    "error-callback": () => {
      resendCaptchaResponse.value = "";
    },
  });
}

// 为重发准备人机验证：按需取配置、展开验证区域并加载脚本渲染组件。
// 返回 true 表示可以继续（未启用验证，或验证已就绪）；false 表示本轮先停下。
async function openResendCaptchaChallenge() {
  const configLoaded = await loadResendCaptchaConfig();
  if (!configLoaded) {
    return false;
  }

  const captcha = resendCaptchaConfig.value.captcha;
  if (!captcha?.enabled) {
    return true;
  }

  if (!captcha.ready || !captcha.widget || !captcha.script) {
    verificationMessage.value = "人机验证暂不可用，请稍后再试。";
    return false;
  }

  resetResendCaptcha();
  showResendCaptcha.value = true;
  await nextTick();

  try {
    await loadTurnstileScript(captcha.script);
    renderResendCaptcha();
    return true;
  } catch (error) {
    resetResendCaptcha();
    verificationMessage.value = "人机验证加载失败，请稍后再试。";
    return false;
  }
}

// 重新发送验证码：冷却、配置、人机验证都通过后调接口，成功后重新开始冷却。
// 启用验证码时，第一次点击只负责展开挑战并提示用户完成后再点一次。
async function resendVerificationCode() {
  if (requestPending.value) {
    return;
  }

  if (resendCooldownRemaining.value > 0) {
    return;
  }

  const registration = pendingRegistration.value;
  if (!registration) {
    verificationMessage.value = "注册信息已失效，请重新注册。";
    return;
  }

  const configLoaded = await loadResendCaptchaConfig();
  if (!configLoaded) {
    return;
  }

  const captcha = resendCaptchaConfig.value.captcha;
  if (captcha?.enabled && !resendCaptchaResponse.value) {
    const challengeOpened = await openResendCaptchaChallenge();
    if (challengeOpened && captcha.ready) {
      verificationMessage.value = "请完成人机验证后再次点击重新发送。";
    }
    return;
  }

  resending.value = true;
  verificationMessage.value = "正在重新发送验证码，请稍候...";
  try {
    const payload = {
      email: registration.email,
      username: registration.username,
      ...(import.meta.env.VITE_DEV_TICKET ? { dev_ticket: import.meta.env.VITE_DEV_TICKET } : {}),
      ...(captcha?.enabled ? { captcha: { response: resendCaptchaResponse.value } } : {}),
    };

    await authApi.sendVerificationCode(payload);
    verificationMessage.value = `验证码已重新发送至 ${registration.email}。`;
    startResendCooldown();
  } catch (error) {
    verificationMessage.value = error?.payload?.error?.message || error?.payload?.message || error?.message || "验证码重发失败。";
  } finally {
    resending.value = false;
    resetResendCaptcha();
  }
}

// 放弃当前验证流程：清掉待验证载荷并返回登录页。
function goBackToAuth() {
  state.user.pendingRegistration = null;
  verificationCode.value = "";
  verificationMessage.value = "";
  router.goToRoute("/register");
}

// 用输入的验证码完成注册：成功后写入当前用户、清空待验证载荷并回到登录页。
async function completeVerification() {
  if (requestPending.value) {
    return;
  }

  const registration = pendingRegistration.value;
  if (!registration) {
    verificationMessage.value = "注册信息已失效，请重新注册。";
    router.goToRoute("/register");
    return;
  }

  const enteredCode = String(verificationCode.value ?? "").trim();

  if (!enteredCode) {
    verificationMessage.value = "验证码不能为空。";
    return;
  }

  if (enteredCode.length !== verificationCodeLength.value) {
    verificationMessage.value = `请输入 ${verificationCodeLength.value} 位验证码。`;
    return;
  }

  verifying.value = true;
  verificationMessage.value = "正在验证并完成注册，请稍候...";
  try {
    const response = await authApi.verifyVerificationCode({
      email: registration.email,
      code: enteredCode,
    });

    const payload = response?.data ?? response ?? {};
    if (!response?.ok && payload?.ok === false) {
      verificationMessage.value = payload?.message || "验证码错误，请重新输入。";
      return;
    }

    const account = payload?.account ?? response?.account ?? null;
    if (account) {
      state.user.currentUser = {
        id: account.id,
        username: account.username,
        email: registration.email || "",
        playerNo: account.player_no || "",
        role: account.role || "player",
        team: account.team || null,
      };
    }

    state.user.pendingRegistration = null;
    verificationCode.value = "";
    verificationMessage.value = "注册验证已完成。";
    router.goToRoute("/register");
    return;
  } catch (error) {
    verificationMessage.value = error?.payload?.error?.message || error?.payload?.message || error?.message || "验证码校验失败。";
    return;
  } finally {
    verifying.value = false;
  }
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">安全验证</p>
        <h1>邮箱验证</h1>
      </div>
    </header>

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <p class="panel-card__label">验证码</p>
        <h2>请输入验证码</h2>
        <p class="verification-help">
          验证码已发送到 <strong>{{ verificationTarget }}</strong>
        </p>
        <p class="verification-help">
          验证码有效期为 {{ verificationCodeTtlMinutes }} 分钟。
        </p>

        <label class="verification-field">
          <span>验证码</span>
          <input
            v-model="verificationCode"
            type="text"
            :maxlength="verificationCodeLength"
            :placeholder="`请输入 ${verificationCodeLength} 位验证码`"
          />
        </label>

        <div v-if="showResendCaptcha" class="captcha-box">
          <span>人机验证</span>
          <div ref="resendCaptchaContainer" class="turnstile-wrap"></div>
        </div>

        <div class="verification-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="requestPending || resendCooldownRemaining > 0"
            @click="resendVerificationCode"
          >
            {{
              resending
                ? "发送中，请稍候..."
                : resendCooldownRemaining > 0
                  ? `${resendCooldownRemaining} 秒后可重发`
                  : "重新发送"
            }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="requestPending"
            @click="goBackToAuth"
          >
             返回登录 / 注册
          </button>
        </div>
        
        <button
          class="ghost-button"
          type="button"
          :disabled="requestPending"
          @click="completeVerification"
        >
            {{ verifying ? "验证中，请稍候..." : "完成注册" }}
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

.captcha-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.turnstile-wrap {
  min-height: 60px;
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
