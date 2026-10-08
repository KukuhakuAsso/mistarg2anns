<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useGameState } from "@/composables/useGameState";
import { useAuth } from "@/composables/useAuth";
import { router } from "@/router";
import { probeHealth } from "@/api/health";
import { authApi } from "@/api/auth";

const emit = defineEmits(["close"]);

const { state } = useGameState();
const { loginWithPassword } = useAuth();
const authMode = ref("login");
const authSubmitting = ref(false);
const logoutSubmitting = ref("");
const healthStatus = ref({
  loading: true,
  ok: null,
  message: "正在检查服务状态...",
});
const usernameChecking = ref(false);
const usernameStatus = ref("idle");
const usernameCheckTimer = ref(null);
const registrationConfig = ref({
  captcha: {
    enabled: false,
    ready: false,
    mode: "turnstile",
    site_key: "",
    script: "",
    test_hosts: [],
    test_ticket_required: false,
  },
  code_length: 6,
  code_ttl_minutes: 10,
  resend_cooldown_sec: 60,
});
const captchaContainer = ref(null);
const turnstileWidgetId = ref(null);
const captchaResponse = ref("");
let usernameCheckRequestId = 0;
const authForm = ref({
  username: "",
  email: "",
  loginIdentifier: "",
  password: "",
  confirmPassword: "",
});
const authMessage = ref("");

const currentUserEmail = computed(() => state.user.currentUser?.email || "");
const currentUsernameDraft = ref("");
const usernameChangeState = ref({
  open: false,
  message: "",
  submitting: false,
});
const detectedLoginType = computed(() =>
  authForm.value.loginIdentifier.includes("@") ? "email" : "username",
);
const detectedLoginTypeLabel = computed(() =>
  detectedLoginType.value === "email" ? "邮箱" : "用户名",
);

function normalizeUsername(value) {
  return String(value ?? "").trim();
}

function resetUsernameEditor() {
  usernameChangeState.value = { open: false, message: "", submitting: false };
  currentUsernameDraft.value = "";
}

function openUsernameEditor() {
  if (!state.user.currentUser) {
    return;
  }

  currentUsernameDraft.value = state.user.currentUser.username || "";
  usernameChangeState.value = {
    open: true,
    message: "",
    submitting: false,
  };
}

function validateUsernamePattern(value) {
  const username = normalizeUsername(value);
  if (!username) {
    return { ok: false, message: "用户名不能为空。" };
  }

  if (username.length < 1 || username.length > 32) {
    return { ok: false, message: "用户名长度必须为 1–32 个字符。" };
  }

  const forbiddenPattern = /[@/\\]|\p{C}|\p{So}/u;
  const validPattern = /^[\p{L}\p{N}\p{Zs}_\-\.\+&'()\[\]!#$%*=?^\{\|\}~`]+$/u;

  if (!validPattern.test(username)) {
    return { ok: false, message: "用户名包含非法字符。" };
  }

  if (forbiddenPattern.test(username)) {
    return { ok: false, message: "用户名包含禁止字符。" };
  }

  if (/^M2\d{6}$/i.test(username)) {
    return { ok: false, message: "用户名不能使用玩家编号格式。" };
  }

  return { ok: true, value: username };
}

watch(
  () => authMode.value,
  (nextMode) => {
    if (nextMode === "register") {
      window.setTimeout(() => {
        renderTurnstileWidget();
      }, 0);
    }
  },
  { immediate: true },
);

watch(
  () => authForm.value.username,
  (nextValue) => {
    if (authMode.value !== "register") {
      usernameStatus.value = "idle";
      return;
    }

    const sanitized = normalizeUsername(nextValue);
    if (!sanitized) {
      usernameStatus.value = "idle";
      if (usernameCheckTimer.value) {
        clearTimeout(usernameCheckTimer.value);
        usernameCheckTimer.value = null;
      }
      return;
    }

    const validation = validateUsernamePattern(sanitized);
    if (!validation.ok) {
      usernameStatus.value = "invalid";
      if (usernameCheckTimer.value) {
        clearTimeout(usernameCheckTimer.value);
        usernameCheckTimer.value = null;
      }
      return;
    }

    if (usernameCheckTimer.value) {
      clearTimeout(usernameCheckTimer.value);
    }

    usernameCheckTimer.value = window.setTimeout(async () => {
      const currentRequestId = ++usernameCheckRequestId;
      usernameChecking.value = true;
      usernameStatus.value = "checking";

      try {
        const response = await authApi.usernameAvailable(sanitized);
        if (currentRequestId !== usernameCheckRequestId) {
          return;
        }

        const status = response?.data?.status || response?.status;
        if (status === "available") {
          usernameStatus.value = "available";
        } else if (status === "taken") {
          usernameStatus.value = "taken";
        } else if (status === "unchanged") {
          usernameStatus.value = "unchanged";
        } else {
          usernameStatus.value = "idle";
        }
      } catch (error) {
        if (currentRequestId === usernameCheckRequestId) {
          usernameStatus.value = "idle";
        }
      } finally {
        if (currentRequestId === usernameCheckRequestId) {
          usernameChecking.value = false;
        }
      }
    }, 1000);
  },
);

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
        renderTurnstileWidget();
      }
    }
  } catch (error) {
    registrationConfig.value.captcha.enabled = false;
    registrationConfig.value.captcha.ready = false;
    authMessage.value = "注册配置暂不可用，请稍后再试。";
  }
}

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
      // ignore removal errors and re-render cleanly
    }
  }

  turnstileWidgetId.value = window.turnstile.render(captchaContainer.value, {
    sitekey: siteKey,
    ...(params && typeof params === "object" ? params : {}),
    callback: (response) => {
      captchaResponse.value = response || "";
      window.__captchaResponse = response || "";
    },
    "expired-callback": () => {
      captchaResponse.value = "";
      window.__captchaResponse = "";
    },
    "error-callback": () => {
      captchaResponse.value = "";
      window.__captchaResponse = "";
    },
  });
}

onMounted(async () => {
  try {
    await probeHealth();
    healthStatus.value = {
      loading: false,
      ok: true,
      message: "服务可用",
    };
  } catch (error) {
    healthStatus.value = {
      loading: false,
      ok: false,
      message: error instanceof Error ? error.message : "服务不可用",
    };
  }

  try {
    await loadRegistrationConfig();
  } catch (error) {
    // ignore and keep the form usable without captcha if config is unavailable
  }
});

onBeforeUnmount(() => {
  if (usernameCheckTimer.value) {
    clearTimeout(usernameCheckTimer.value);
    usernameCheckTimer.value = null;
  }
  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore unmount cleanup errors
    }
  }
  usernameCheckRequestId += 1;
});

function switchAuthMode(mode) {
  if (authSubmitting.value) {
    return;
  }

  authMode.value = mode;
  authMessage.value = "";
  authForm.value = {
    username: "",
    email: "",
    loginIdentifier: "",
    password: "",
    confirmPassword: "",
  };
  usernameStatus.value = "idle";
  usernameChecking.value = false;
  captchaResponse.value = "";
  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore removal errors
    }
    turnstileWidgetId.value = null;
  }
  if (mode === "register") {
    window.setTimeout(() => {
      renderTurnstileWidget();
    }, 0);
  }
}

function validateRegisterForm() {
  const username = String(authForm.value.username ?? "").trim();
  const nickname = String(authForm.value.nickname ?? "").trim();
  const email = String(authForm.value.email ?? "").trim();
  const password = String(authForm.value.password ?? "").trim();
  const confirmPassword = String(authForm.value.confirmPassword ?? "").trim();

  if (!username || !email) {
    authMessage.value = "用户名和邮箱不能为空。";
    return null;
  }

  const usernamePatternResult = validateUsernamePattern(username);
  if (!usernamePatternResult.ok) {
    authMessage.value = usernamePatternResult.message;
    return null;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    authMessage.value = "请输入有效的邮箱地址。";
    return null;
  }

  if (password || confirmPassword) {
    if (password.length < 8) {
      authMessage.value = "密码长度至少需要 8 位。";
      return null;
    }

    if (!confirmPassword) {
      authMessage.value = "请输入确认密码，或将密码留空。";
      return null;
    }

    if (password !== confirmPassword) {
      authMessage.value = "两次输入的密码不一致。";
      return null;
    }
  }

  const captcha = registrationConfig.value.captcha;
  if (captcha?.enabled && captcha?.ready && !captchaResponse.value) {
    authMessage.value = "请完成人机验证后再继续。";
    return null;
  }

  return { username, nickname: username, email, password };
}

function proceedToRegistrationVerification({
  username,
  email,
  password,
  sentEmail = email,
  generatedCode = "",
}) {
  state.user.auth.verificationRequired = true;
  state.user.auth.verificationMode = "register";
  state.user.auth.pendingRegister = {
    username,
    nickname: username,
    email,
    password,
  };
  state.user.auth.pendingLogin = null;
  state.user.auth.generatedCode = generatedCode;

  authMessage.value = `验证码已发送至 ${sentEmail}，请在下一页完成验证。`;
  router.goToRoute("/verification");
}

async function startRegisterVerification() {
  if (authSubmitting.value) {
    return;
  }

  const validated = validateRegisterForm();
  if (!validated) {
    return;
  }

  const { username, email, password } = validated;

  const captcha = registrationConfig.value.captcha;
  if (captcha?.enabled && captcha?.ready && !captchaResponse.value) {
    authMessage.value = "请完成人机验证后再发送验证码。";
    return;
  }

  authSubmitting.value = true;
  authMessage.value = "正在发送验证码，请稍候...";
  try {
    const payload = {
      email,
      username,
      captcha: captcha?.enabled
        ? { response: captchaResponse.value }
        : undefined,
      dev_ticket: import.meta.env.VITE_DEV_TICKET || "",
    };

    const response = await authApi.sendVerificationCode(payload);
    proceedToRegistrationVerification({
      username,
      email,
      password,
      sentEmail: response?.data?.email || email,
      generatedCode: response?.data?.code || "",
    });
  } catch (error) {
    if (error?.status === 429) {
      proceedToRegistrationVerification({ username, email, password });
      return;
    }

    const serverMessage =
      error?.payload?.error?.message ||
      error?.payload?.message ||
      error?.message ||
      "验证码发送失败，请稍后再试。";
    authMessage.value = serverMessage;
  } finally {
    authSubmitting.value = false;
  }
}

async function handleAuthSubmit() {
  if (authSubmitting.value) {
    return;
  }

  if (authMode.value === "register") {
    await startRegisterVerification();
    return;
  }

  const identifier = String(authForm.value.loginIdentifier ?? "").trim();
  const password = String(authForm.value.password ?? "").trim();

  if (!identifier) {
    authMessage.value = "请输入邮箱或用户名。";
    return;
  }

  if (/^M2\d{6}$/i.test(identifier)) {
    authMessage.value = "不再支持玩家编号登录，请使用邮箱或用户名。";
    return;
  }

  const loginType = detectedLoginType.value;
  if (loginType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    authMessage.value = "请输入有效的邮箱地址。";
    return;
  }

  if (loginType === "username") {
    const usernameValidation = validateUsernamePattern(identifier);
    if (!usernameValidation.ok) {
      authMessage.value = usernameValidation.message;
      return;
    }
  }

  if (!password) {
    authMessage.value = "密码不能为空。";
    return;
  }

  authSubmitting.value = true;
  authMessage.value = "正在登录，请稍候...";
  try {
    const result = await loginWithPassword({
      type: loginType,
      identifier,
      password,
    });

    const account = result?.account ?? null;
    if (account) {
      state.user.currentUser = {
        username: account.username ?? account.player_no ?? identifier,
        nickname: account.username ?? account.player_no ?? identifier,
        email: account.email ?? "",
        playerNo: account.player_no ?? "",
        role: account.role ?? "player",
        team: account.team ?? null,
      };
    }

    state.user.auth.loginFailureCount = 0;
    state.user.auth.verificationRequired = false;
    state.user.auth.pendingLogin = null;
    state.user.auth.pendingRegister = null;
    state.user.auth.generatedCode = "";

    authMessage.value = account ? "登录成功。" : "登录成功，正在同步会话状态。";
    authForm.value = {
      username: "",
      email: "",
      loginIdentifier: "",
      password: "",
      confirmPassword: "",
    };
  } catch (error) {
    authMessage.value = error?.message || "登录失败。";
  } finally {
    authSubmitting.value = false;
  }
}

async function submitUsernameChange() {
  if (!state.user.currentUser) {
    return;
  }

  const nextUsername = normalizeUsername(currentUsernameDraft.value);
  const validation = validateUsernamePattern(nextUsername);

  if (!nextUsername) {
    usernameChangeState.value.message = "用户名不能为空。";
    return;
  }

  if (!validation.ok) {
    usernameChangeState.value.message = validation.message;
    return;
  }

  const currentUsername = normalizeUsername(
    state.user.currentUser.username || "",
  );
  if (nextUsername.toLowerCase() === currentUsername.toLowerCase()) {
    usernameChangeState.value.message = "新用户名与当前用户名相同，无需修改。";
    return;
  }

  usernameChangeState.value.submitting = true;
  usernameChangeState.value.message = "正在校验用户名，请稍候...";

  try {
    const availability = await authApi.usernameAvailable(nextUsername);
    const availabilityStatus =
      availability?.data?.status ?? availability?.status ?? "";

    if (availabilityStatus === "taken") {
      usernameChangeState.value.message = "该用户名已被占用，请换一个用户名。";
      return;
    }

    if (availabilityStatus === "invalid") {
      usernameChangeState.value.message = "用户名格式不符合规则。";
      return;
    }

    usernameChangeState.value.message = "正在更新用户名，请稍候...";

    const response = await authApi.changeUsername({ username: nextUsername });
    const account = response?.data?.account ?? response?.account ?? null;
    const updatedUsername = account?.username ?? nextUsername;

    if (state.user.currentUser) {
      state.user.currentUser.username = updatedUsername;
      state.user.currentUser.nickname = updatedUsername;
      if (account?.playerNo || account?.player_no) {
        state.user.currentUser.playerNo =
          account.playerNo ??
          account.player_no ??
          state.user.currentUser.playerNo;
      }
      if (account?.email) {
        state.user.currentUser.email = account.email;
      }
    }

    usernameChangeState.value.message = "用户名已更新。";
    window.setTimeout(() => {
      resetUsernameEditor();
    }, 500);
  } catch (error) {
    const payload = error?.payload ?? {};
    const code = payload?.code || payload?.error?.code || error?.code || "";
    const detail = payload?.detail ?? payload?.error?.detail ?? {};

    if (code === "E_VALIDATION") {
      usernameChangeState.value.message =
        detail?.fields?.username || "用户名格式不符合规则。";
    } else if (code === "E_AUTH") {
      usernameChangeState.value.message = "未登录或令牌失效，无法修改用户名。";
    } else if (code === "E_BANNED") {
      usernameChangeState.value.message = "账号已被封禁，不能修改用户名。";
    } else if (code === "E_CONFLICT") {
      usernameChangeState.value.message = "该用户名已被占用，请换一个用户名。";
    } else {
      usernameChangeState.value.message =
        error?.message || "用户名修改失败，请稍后再试。";
    }
  } finally {
    usernameChangeState.value.submitting = false;
  }
}

async function handleLogout(allDevices = false) {
  if (logoutSubmitting.value) {
    return;
  }

  logoutSubmitting.value = allDevices ? "all" : "current";
  authMessage.value = `正在${allDevices ? "退出全部设备登录" : "退出登录"}，请稍候...`;
  try {
    if (allDevices) {
      await authApi.logoutAll();
    } else {
      await authApi.logout();
    }
    authMessage.value = allDevices
      ? "已退出全部设备登录。"
      : "已退出当前设备登录。";
  } catch (error) {
    authMessage.value = `退出请求失败：${error?.message || "请稍后重试"}。本地登录状态已清除。`;
  } finally {
    state.user.currentUser = null;
    logoutSubmitting.value = "";
  }
}
</script>

<style scoped>
.current-user-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}
</style>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">账户</p>
        <h1>登录 / 注册</h1>
      </div>
    </header>

    <div class="page-shell__body">
      <div v-if="state.user.currentUser" class="panel-card panel-card--wide">
        <p class="panel-card__label">当前账户</p>
        <h2>{{ state.user.currentUser.nickname }}</h2>
        <p>@{{ state.user.currentUser.username }}</p>
        <p v-if="currentUserEmail">{{ currentUserEmail }}</p>
        <div class="current-user-actions">
          <button
            class="secondary-button"
            type="button"
            @click="openUsernameEditor"
          >
            修改用户名
          </button>
          <button
            class="secondary-button"
            type="button"
            @click="router.goToRoute('/password')"
          >
            修改密码
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="Boolean(logoutSubmitting)"
            @click="handleLogout()"
          >
            {{
              logoutSubmitting === "current"
                ? "退出中，请稍候..."
                : "退出登录"
            }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="Boolean(logoutSubmitting)"
            @click="handleLogout(true)"
          >
            {{
              logoutSubmitting === "all"
                ? "正在退出全部设备，请稍候..."
                : "退出全部设备登录"
            }}
          </button>
        </div>

        <p v-if="authMessage" class="helper-text">{{ authMessage }}</p>

        <div v-if="usernameChangeState.open" class="username-change-form">
          <label class="field">
            <span>新用户名</span>
            <input
              v-model="currentUsernameDraft"
              type="text"
              placeholder="请输入新用户名"
            />
          </label>

          <div
            v-if="usernameChangeState.message"
            class="status-box"
            :class="{
              'status-box--error':
                usernameChangeState.message.includes('失败') ||
                usernameChangeState.message.includes('不可') ||
                usernameChangeState.message.includes('已被') ||
                usernameChangeState.message.includes('不符合') ||
                usernameChangeState.message.includes('无效') ||
                usernameChangeState.message.includes('相同') ||
                usernameChangeState.message.includes('被封禁') ||
                usernameChangeState.message.includes('失效') ||
                usernameChangeState.message.includes('占用'),
              'status-box--success':
                usernameChangeState.message.includes('已更新'),
            }"
          >
            {{ usernameChangeState.message }}
          </div>

          <div class="inline-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="usernameChangeState.submitting"
              @click="resetUsernameEditor"
            >
              取消
            </button>
            <button
              class="primary-button"
              type="button"
              :disabled="usernameChangeState.submitting"
              @click="submitUsernameChange"
            >
              {{
                usernameChangeState.submitting
                  ? "保存中，请稍候..."
                  : "保存用户名"
              }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="panel-card panel-card--wide">
        <div
          class="auth-health"
          :class="{
            'is-ok': healthStatus.ok === true,
            'is-error': healthStatus.ok === false,
          }"
        >
          <span>{{
            healthStatus.loading
              ? "检查中"
              : healthStatus.ok
                ? "服务在线"
                : "服务离线"
          }}</span>
          <small>{{ healthStatus.message }}</small>
        </div>

        <div class="auth-tabs">
          <button
            :class="{ 'is-active': authMode === 'login' }"
            type="button"
            :disabled="authSubmitting"
            @click="switchAuthMode('login')"
          >
            登录
          </button>
          <button
            :class="{ 'is-active': authMode === 'register' }"
            type="button"
            :disabled="authSubmitting"
            @click="switchAuthMode('register')"
          >
            注册
          </button>
        </div>

        <form class="auth-form" @submit.prevent="handleAuthSubmit">
          <template v-if="authMode === 'login'">
            <label>
              <span>{{ detectedLoginTypeLabel }}</span>
              <input
                v-model="authForm.loginIdentifier"
                type="text"
                :placeholder="`请输入${detectedLoginTypeLabel}`"
                autocomplete="username"
              />
            </label>
          </template>

          <label v-else>
            <span>用户名</span>
            <input
              v-model="authForm.username"
              type="text"
              placeholder="请输入用户名"
            />
            <small
              v-if="authForm.username"
              class="username-status"
              :class="usernameStatus"
            >
              <template v-if="usernameChecking">检查中，请稍候...</template>
              <template v-else-if="usernameStatus === 'available'"
                >用户名可用</template
              >
              <template v-else-if="usernameStatus === 'taken'"
                >用户名已被占用</template
              >
              <template v-else-if="usernameStatus === 'unchanged'"
                >这是当前账号用户名</template
              >
              <template v-else-if="usernameStatus === 'invalid'"
                >用户名格式不符合规则</template
              >
            </small>
          </label>

          <label v-if="authMode === 'register'">
            <span>邮箱</span>
            <input
              v-model="authForm.email"
              type="text"
              placeholder="请输入邮箱地址"
            />
          </label>

          <label>
            <span>{{ authMode === "register" ? "密码（可选）" : "密码" }}</span>
            <input
              v-model="authForm.password"
              type="password"
              :placeholder="
                authMode === 'register'
                  ? '可不填写；如填写，至少 8 位'
                  : '请输入密码'
              "
            />
          </label>

          <label v-if="authMode === 'register'">
            <span>确认密码（可选）</span>
            <input
              v-model="authForm.confirmPassword"
              type="password"
              placeholder="填写密码时请再次输入"
            />
          </label>

          <div
            v-if="
              authMode === 'register' && registrationConfig.captcha?.enabled
            "
            class="captcha-box"
          >
            <div
              v-if="registrationConfig.captcha.ready"
              ref="captchaContainer"
              class="turnstile-wrap"
            ></div>
            <small v-else class="captcha-hint"
              >人机验证暂不可用，请稍后再试。</small
            >
          </div>

          <div class="auth-footer">
            <button class="primary-button" type="submit" :disabled="authSubmitting">
              {{
                authSubmitting
                  ? authMode === "register"
                    ? "发送中，请稍候..."
                    : "登录中，请稍候..."
                  : authMode === "register"
                    ? "发送验证码"
                    : "登录"
              }}
            </button>
            <button
              class="text-link-button"
              type="button"
              @click="router.goToRoute('/forgot')"
            >
              找回密码
            </button>
          </div>
        </form>

        <p v-if="authMessage" class="helper-text">{{ authMessage }}</p>
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

.panel-card p {
  margin: 0;
  color: var(--text-dim);
}

.auth-tabs {
  display: flex;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.auth-tabs button {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.auth-tabs button.is-active {
  border-color: var(--border-strong);
  background: rgba(255, 255, 255, 0.04);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.auth-form label,
.verification-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.auth-form input,
.verification-field input {
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

.auth-form input:focus,
.verification-field input:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
  background: rgba(18, 24, 36, 0.14);
}

.captcha-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

.turnstile-wrap {
  min-height: 60px;
}

.captcha-hint {
  color: var(--text-dim);
}

.verification-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.verification-help {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.6;
}

.verification-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.primary-button,
.secondary-button,
.bar-btn {
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

.username-change-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.username-change-form .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.username-change-form .field input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(8, 13, 20, 0.12);
  color: var(--text);
  box-sizing: border-box;
  font: inherit;
}

.username-change-form .field input:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
  background: rgba(18, 24, 36, 0.14);
}

.status-box {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
}

.status-box--success {
  border-color: rgba(61, 200, 128, 0.3);
  background: rgba(61, 200, 128, 0.08);
  color: #7fe0a8;
}

.status-box--error {
  border-color: rgba(255, 93, 93, 0.25);
  background: rgba(255, 93, 93, 0.08);
  color: #ff9f9f;
}

.inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.auth-footer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.text-link-button {
  width: fit-content;
  border: none;
  background: transparent;
  padding: 0;
  color: var(--accent);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}

.helper-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
}

.username-status {
  display: block;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
}

.username-status.available {
  color: #6ce39b;
}

.username-status.taken,
.username-status.invalid {
  color: #ff8a80;
}

.username-status.unchanged,
.username-status.checking {
  color: #ffd166;
}
</style>
