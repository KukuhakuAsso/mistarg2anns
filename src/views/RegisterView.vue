<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useGameState } from "@/composables/useGameState";
import { useNameAvailability } from "@/composables/useNameAvailability";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { router } from "@/router";
import { probeHealth } from "@/api/health";
import { authApi } from "@/api/auth";
import { extractErrorMessage, extractFieldMessages } from "@/api/errors";
import { loginWithPassword } from "@/config/auth";
import NameStatus from "@/components/NameStatus.vue";
import StatusMessage from "@/components/StatusMessage.vue";
import UserTabs from "@/components/UserTabs.vue";

// 注册视图的状态与逻辑，包括登录、注册、用户名修改等功能。
const { state, applyAccountSnapshot, consumeSessionNotice } = useGameState();
// 当前的认证模式：login = 登录，register = 注册。
const authMode = ref("login");
// 表单提交状态，包括登录、登出等操作。
const authSubmitting = ref(false);
// 登出操作的提交状态。
const logoutSubmitting = ref("");
// 服务健康检查状态。仅测试使用
const healthStatus = ref({
  loading: true,
  ok: null,
  message: "正在检查服务状态...",
});
// 注册配置，包括验证码、短信验证码等设置。
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
// 当前凭据是否已被某次发码请求消耗掉：人机验证凭据是一次性的，
// 用掉后组件仍停在「已验证」，必须重置组件才能再拿到一份。
const captchaTokenUsed = ref(false);
// 注册流程的当前阶段：form = 填写表单并发送验证码，verify = 填写验证码完成注册。
const registerStep = ref("form");
// 验证码实际发送到的邮箱（以后端回传为准），用于第二步文案与重发。
const sentEmail = ref("");
// 第二步输入的验证码。
const verificationCode = ref("");
// 重发验证码的冷却剩余秒数。
const resendCooldownRemaining = ref(0);
let resendCooldownTimer = null;
// 表单数据与消息状态，包括登录、注册所需的字段及提示信息。
const authForm = ref({
  username: "",
  email: "",
  loginIdentifier: "",
  password: "",
  confirmPassword: "",
});
// 全局提示（登录 / 注册 / 账号操作共用）：文案与语义色统一由 useStatusMessage 管理。
const {
  message: authMessage,
  tone: authMessageTone,
  set: setAuthMessage,
  clear: clearAuthMessage,
} = useStatusMessage();

// 当前登录用户的邮箱，用于账号面板展示。
const currentUserEmail = computed(() => state.user.currentUser?.email || "");

// 当前用户名修改草稿，用于内联编辑器。
const currentUsernameDraft = ref("");
// 用户名修改的提交状态（查重状态由 useNameAvailability 提供）。
const usernameChangeState = ref({
  open: false,
  submitting: false,
});
// 用户名修改的结果提示：文案与语义色统一由 useStatusMessage 管理。
const {
  message: usernameChangeMessage,
  tone: usernameChangeMessageTone,
  set: setUsernameChangeMessage,
  clear: clearUsernameChangeMessage,
} = useStatusMessage();
// 按输入内容推断登录类型：含 @ 视为邮箱，否则按用户名处理。
const detectedLoginType = computed(() =>
  authForm.value.loginIdentifier.includes("@") ? "email" : "username",
);
// 上者对应的中文标签，用于表单提示。
const detectedLoginTypeLabel = computed(() =>
  detectedLoginType.value === "email" ? "邮箱" : "用户名",
);
// 验证码位数，取自后端注册配置；未下发或非法时按 6 位。
const verificationCodeLength = computed(() => {
  const codeLength = Number(registrationConfig.value.code_length);
  return Number.isInteger(codeLength) && codeLength > 0 ? codeLength : 6;
});
// 验证码有效期（分钟），仅用于第二步提示；未下发或非法时按 10 分钟。
const verificationCodeTtlMinutes = computed(() => {
  const ttlMinutes = Number(registrationConfig.value.code_ttl_minutes);
  return Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;
});

// 用户名统一去除首尾空白，并返回处理后的值。
function normalizeUsername(value) {
  return String(value ?? "").trim();
}

// 收起「修改用户名」内联编辑器，并清空草稿与校验状态。
function resetUsernameEditor() {
  usernameChangeState.value = { open: false, submitting: false };
  currentUsernameDraft.value = "";
  resetUsernameChangeCheck();
  clearUsernameChangeMessage();
}

// 打开「修改用户名」编辑器，草稿以当前用户名为起点。
function openUsernameEditor() {
  if (!state.user.currentUser) {
    return;
  }

  currentUsernameDraft.value = state.user.currentUser.username || "";
  usernameChangeState.value = { open: true, submitting: false };
  clearUsernameChangeMessage();
}

// 校验用户名规则（1–32 字符、字符白名单、禁用字符、禁止玩家编号格式）；
// 通过返回 { ok: true, value }，否则返回 { ok: false, message }。
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

// 切到注册页签时（含初始化）渲染人机验证组件，此时容器才挂载好。
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

// 第一步发码后再改邮箱会使已发出的验证码失效：退回第一步，提示重新发送。
watch(
  () => authForm.value.email,
  () => {
    if (authMode.value === "register" && registerStep.value === "verify") {
      backToRegisterForm("邮箱已修改，请重新发送验证码。");
    }
  },
);

// 注册用户名校验：本地规则即时反馈，规则通过后防抖查唯一性（共用 useNameAvailability）。
const {
  status: usernameStatus,
  message: usernameStatusMessage,
  reset: resetUsernameCheck,
} = useNameAvailability({
  value: () => authForm.value.username,
  validate: validateUsernamePattern,
  normalize: normalizeUsername,
  check: (name) => authApi.usernameAvailable(name),
  // 仅在注册页签下查重：切到登录页签即回落为空闲，不显示旧结论。
  enabled: () => authMode.value === "register",
  // 已被当前账号占用：注册场景不会命中，保留给「修改用户名」那一处使用。
  messages: {
    checking: "检查中，请稍候...",
    available: "用户名可用",
    taken: "用户名已被占用",
  },
});

// 账号面板里「新用户名」草稿的查重：与本机当前用户名相同时提示 unchanged，其余同上。
const {
  status: usernameChangeStatus,
  message: usernameChangeStatusMessage,
  reset: resetUsernameChangeCheck,
} = useNameAvailability({
  value: currentUsernameDraft,
  validate: validateUsernamePattern,
  normalize: normalizeUsername,
  check: (name) => authApi.usernameAvailable(name),
  // 编辑器收起时不做任何检查。
  enabled: () => usernameChangeState.value.open,
  unchanged: (name) =>
    name.toLowerCase() ===
    normalizeUsername(state.user.currentUser?.username || "").toLowerCase(),
  messages: {
    checking: "检查中，请稍候...",
    available: "用户名可用",
    taken: "用户名已被占用",
    unchanged: "这是当前账号用户名",
  },
});

// 拉取后端注册配置，必要时加载 Turnstile 脚本并渲染组件；失败则关掉人机验证并提示用户。
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
    setAuthMessage("error", "注册配置暂不可用，请稍后再试。");
  }
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

// 在注册表单的容器里渲染人机验证，回调把凭据写回 captchaResponse；配置未就绪或缺容器 / 脚本时跳过。
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
      captchaTokenUsed.value = false;
    },
    "expired-callback": () => {
      captchaResponse.value = "";
      captchaTokenUsed.value = false;
    },
    "error-callback": () => {
      captchaResponse.value = "";
      captchaTokenUsed.value = false;
    },
  });
}

// 进入页面时清空上一次的验证结果，探测一次服务健康（供状态条展示），再加载注册配置。
onMounted(async () => {
  captchaResponse.value = "";

  // 被强制登出（封禁 / 会话失效）时留下的一次性提示，在这里展示给用户
  const notice = consumeSessionNotice();
  if (notice) {
    setAuthMessage("error", notice);
  }

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

// 离开页面时停止重发冷却、销毁人机验证组件（查重定时器由 useNameAvailability 自行清理）。
onBeforeUnmount(() => {
  clearResendCooldown();
  if (turnstileWidgetId.value !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(turnstileWidgetId.value);
    } catch (error) {
      // ignore unmount cleanup errors
    }
  }
  turnstileWidgetId.value = null;
  captchaResponse.value = "";
});

// 切换登录 / 注册页签：清空表单与提示、重置注册流程、销毁旧的人机验证并在注册页签下重建；提交过程中不允许切换。
function switchAuthMode(mode) {
  if (authSubmitting.value) {
    return;
  }

  authMode.value = mode;
  clearAuthMessage();
  registerStep.value = "form";
  sentEmail.value = "";
  verificationCode.value = "";
  clearResendCooldown();
  authForm.value = {
    username: "",
    email: "",
    loginIdentifier: "",
    password: "",
    confirmPassword: "",
  };
  resetUsernameCheck();
  captchaResponse.value = "";
  captchaTokenUsed.value = false;
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

// 校验发送验证码所需字段：邮箱格式 + 人机验证；不通过时已写入提示，返回 null。
function validateEmailField() {
  const email = String(authForm.value.email ?? "").trim();

  if (!email) {
    setAuthMessage("error", "请输入邮箱地址。");
    return null;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    setAuthMessage("error", "请输入有效的邮箱地址。");
    return null;
  }

  if (!ensureCaptchaToken()) {
    return null;
  }

  return email;
}

// 校验完成注册所需字段（用户名规则、邮箱格式、可选的两次密码一致）；
// 不通过时已直接写入提示，返回 null 表示失败。
function validateRegisterForm() {
  const username = String(authForm.value.username ?? "").trim();
  const email = String(authForm.value.email ?? "").trim();
  const password = String(authForm.value.password ?? "").trim();
  const confirmPassword = String(authForm.value.confirmPassword ?? "").trim();

  if (!username || !email) {
    setAuthMessage("error", "用户名和邮箱不能为空。");
    return null;
  }

  const usernamePatternResult = validateUsernamePattern(username);
  if (!usernamePatternResult.ok) {
    setAuthMessage("error", usernamePatternResult.message);
    return null;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    setAuthMessage("error", "请输入有效的邮箱地址。");
    return null;
  }

  if (password || confirmPassword) {
    if (password.length < 8) {
      setAuthMessage("error", "密码长度至少需要 8 位。");
      return null;
    }

    if (!confirmPassword) {
      setAuthMessage("error", "请输入确认密码，或将密码留空。");
      return null;
    }

    if (password !== confirmPassword) {
      setAuthMessage("error", "两次输入的密码不一致。");
      return null;
    }
  }

  return { username, email, password };
}

// 发送验证码请求体：只提交邮箱、人机验证与开发票据三个参数。
function buildSendCodePayload(email) {
  const captcha = registrationConfig.value.captcha;

  return {
    email,
    captcha: captcha?.enabled
      ? { response: String(captchaResponse.value ?? "").trim() }
      : undefined,
    dev_ticket: import.meta.env.VITE_DEV_TICKET || "",
  };
}

// 停止重发冷却倒计时并归零。
function clearResendCooldown() {
  if (resendCooldownTimer !== null) {
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = null;
  }
  resendCooldownRemaining.value = 0;
}

// 按后端配置的冷却秒数启动重发倒计时；为 0 或非法时不启动。
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

// 重置人机验证组件，回到「待验证」状态（需要一份新凭据时调用）。
function refreshCaptcha() {
  captchaResponse.value = "";
  captchaTokenUsed.value = false;
  renderTurnstileWidget();
}

// 发码成功后凭据已被后端用掉：只清空本地凭据并标记为已用，不立刻重渲染组件，
// 否则用户什么都没点就会看到又要重新验证一次。
function markCaptchaTokenUsed() {
  captchaResponse.value = "";
  captchaTokenUsed.value = true;
}

// 发码前确保手里有一份可用凭据：没有时提示；若上一次凭据已被用掉，顺带重置组件让用户能重新验证。
function ensureCaptchaToken() {
  const captcha = registrationConfig.value.captcha;
  if (!captcha?.enabled || !captcha?.ready) {
    return true;
  }

  if (captchaResponse.value) {
    return true;
  }

  if (captchaTokenUsed.value) {
    refreshCaptcha();
    setAuthMessage(
      "info",
      "上一次的人机验证已被使用，请重新验证后再发送验证码。",
    );
    return false;
  }

  setAuthMessage("error", "请先完成人机验证，再发送验证码。");
  return false;
}

// 回到第一步（保留已填写的表单），并停止重发冷却。
function backToRegisterForm(message, tone = "info") {
  registerStep.value = "form";
  sentEmail.value = "";
  verificationCode.value = "";
  clearResendCooldown();
  setAuthMessage(tone, message);
}

// 进入第二步：记录收件邮箱、清空验证码、开始冷却，并写入结果提示。
// 本次发码已用掉人机验证凭据，这里只标记为已用；用户真的点「重新发送」时才重置组件要求重新验证。
function enterVerifyStep(email, message, tone) {
  sentEmail.value = email;
  verificationCode.value = "";
  registerStep.value = "verify";
  startResendCooldown();
  markCaptchaTokenUsed();
  setAuthMessage(tone, message);
}

// 第一步：邮箱格式与人机验证通过即请求发送验证码。
// 429 表示发送过于频繁（验证码已发出过），按发送成功处理，直接进入第二步。
async function sendRegisterCode() {
  if (authSubmitting.value) {
    return;
  }

  const email = validateEmailField();
  if (!email) {
    return;
  }

  authSubmitting.value = true;
  setAuthMessage("pending", "正在发送验证码，请稍候...");
  try {
    const response = await authApi.sendVerificationCode(
      buildSendCodePayload(email),
    );
    enterVerifyStep(
      response?.data?.email || email,
      "验证码已发送，请查收邮箱后填写。",
      "success",
    );
  } catch (error) {
    if (error?.status === 429) {
      enterVerifyStep(email, "验证码此前已发送，请查收邮箱后填写。", "info");
      return;
    }

    setAuthMessage(
      "error",
      extractErrorMessage(error, "验证码发送失败，请稍后再试。"),
    );
  } finally {
    authSubmitting.value = false;
  }
}

// 第二步重发：冷却结束且人机验证通过后，再次请求发送验证码。
async function resendRegisterCode() {
  if (
    authSubmitting.value ||
    registerStep.value !== "verify" ||
    resendCooldownRemaining.value > 0
  ) {
    return;
  }

  const email = sentEmail.value;
  if (!email) {
    backToRegisterForm("注册信息已失效，请重新发送验证码。", "error");
    return;
  }

  // 重发要一份新凭据：上一次发码已把凭据用掉，这里会重置组件并提示重新验证。
  if (!ensureCaptchaToken()) {
    return;
  }

  authSubmitting.value = true;
  setAuthMessage("pending", "正在重新发送验证码，请稍候...");
  try {
    await authApi.sendVerificationCode(buildSendCodePayload(email));
    setAuthMessage("success", `验证码已重新发送至 ${email}。`);
    startResendCooldown();
    markCaptchaTokenUsed();
  } catch (error) {
    setAuthMessage("error", extractErrorMessage(error, "验证码重发失败。"));
  } finally {
    authSubmitting.value = false;
  }
}

// 第二步：校验账号信息与验证码后提交注册；成功后写入当前用户并回到第一步。
async function submitRegisterVerification() {
  if (authSubmitting.value) {
    return;
  }

  const validated = validateRegisterForm();
  if (!validated) {
    return;
  }

  const code = String(verificationCode.value ?? "").trim();
  if (!code) {
    setAuthMessage("error", "验证码不能为空。");
    return;
  }

  if (code.length !== verificationCodeLength.value) {
    setAuthMessage(
      "error",
      `请输入 ${verificationCodeLength.value} 位验证码。`,
    );
    return;
  }

  const { username, email, password } = validated;

  authSubmitting.value = true;
  setAuthMessage("pending", "正在验证并完成注册，请稍候...");
  try {
    // 完成注册时需要带上第一步未提交的账号信息。
    const response = await authApi.verifyVerificationCode({
      email,
      username,
      password,
      dev_ticket: import.meta.env.VITE_DEV_TICKET || "",
      code,
    });

    const payload = response?.data ?? response ?? {};
    if (!response?.ok && payload?.ok === false) {
      setAuthMessage(
        "error",
        extractErrorMessage(payload, "验证码错误，请重新输入。"),
      );
      return;
    }

    const account = payload?.account ?? response?.account ?? null;
    if (account) {
      state.user.currentUser = {
        id: account.id ?? null,
        username: account.username ?? username,
        email: account.email ?? email,
        playerNo: account.player_no ?? "",
        role: account.role ?? "player",
        team: account.team ?? null,
      };
    }

    // 成功后 currentUser 已写入，页面会切到账户面板，这里只需复位注册流程。
    const doneMessage = account
      ? "注册验证已完成。"
      : "注册验证已完成，正在同步会话状态。";
    backToRegisterForm(doneMessage, "success");
    authForm.value = {
      username: "",
      email: "",
      loginIdentifier: "",
      password: "",
      confirmPassword: "",
    };
  } catch (error) {
    const payload = error?.payload ?? {};
    const errorCode =
      payload?.code || payload?.error?.code || error?.code || "";

    if (errorCode === "E_AUTH") {
      setAuthMessage("error", "验证码无效或已过期，请重新发送验证码。");
      return;
    }

    setAuthMessage("error", extractErrorMessage(error, "验证码校验失败。"));
  } finally {
    authSubmitting.value = false;
  }
}

// 表单提交总入口：注册模式按当前阶段走发码 / 完成注册，否则按邮箱 / 用户名走登录。
async function handleAuthSubmit() {
  if (authSubmitting.value) {
    return;
  }

  if (authMode.value === "register") {
    if (registerStep.value === "verify") {
      await submitRegisterVerification();
    } else {
      await sendRegisterCode();
    }
    return;
  }

  const identifier = String(authForm.value.loginIdentifier ?? "").trim();
  const password = String(authForm.value.password ?? "").trim();

  if (!identifier) {
    setAuthMessage("error", "请输入邮箱或用户名。");
    return;
  }

  if (/^M2\d{6}$/i.test(identifier)) {
    setAuthMessage("error", "不再支持玩家编号登录，请使用邮箱或用户名。");
    return;
  }

  const loginType = detectedLoginType.value;
  if (loginType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    setAuthMessage("error", "请输入有效的邮箱地址。");
    return;
  }

  if (loginType === "username") {
    const usernameValidation = validateUsernamePattern(identifier);
    if (!usernameValidation.ok) {
      setAuthMessage("error", usernameValidation.message);
      return;
    }
  }

  if (!password) {
    setAuthMessage("error", "密码不能为空。");
    return;
  }

  authSubmitting.value = true;
  setAuthMessage("pending", "正在登录，请稍候...");
  try {
    const result = await loginWithPassword({
      type: loginType,
      identifier,
      password,
    });

    const account = result?.account ?? null;
    if (account) {
      state.user.currentUser = {
        // id 用于判定队长身份与后端 accountId 比对，必须保存。
        id: account.id ?? null,
        username: account.username ?? account.player_no ?? identifier,
        email: account.email ?? "",
        playerNo: account.player_no ?? "",
        role: account.role ?? "player",
        team: account.team ?? null,
      };
      // 封禁账号的登录是成功的（200 + account.banned）：立即按快照标记，
      // 不再等 /me/status，也不会被当成「会话中途被封」而立刻登出。
      applyAccountSnapshot(account);
    }

    setAuthMessage(
      "success",
      account ? "登录成功。" : "登录成功，正在同步会话状态。",
    );
    authForm.value = {
      username: "",
      email: "",
      loginIdentifier: "",
      password: "",
      confirmPassword: "",
    };
  } catch (error) {
    setAuthMessage("error", extractErrorMessage(error, "登录失败。"));
  } finally {
    authSubmitting.value = false;
  }
}

// 提交用户名修改：先查重再调用接口，成功后同步本地用户信息。
async function submitUsernameChange() {
  if (!state.user.currentUser) {
    return;
  }

  const nextUsername = normalizeUsername(currentUsernameDraft.value);
  const validation = validateUsernamePattern(nextUsername);

  if (!nextUsername) {
    setUsernameChangeMessage("error", "用户名不能为空。");
    return;
  }

  if (!validation.ok) {
    setUsernameChangeMessage("error", validation.message);
    return;
  }

  const currentUsername = normalizeUsername(
    state.user.currentUser.username || "",
  );
  if (nextUsername.toLowerCase() === currentUsername.toLowerCase()) {
    setUsernameChangeMessage("info", "新用户名与当前用户名相同，无需修改。");
    return;
  }

  usernameChangeState.value.submitting = true;
  setUsernameChangeMessage("pending", "正在校验用户名，请稍候...");

  try {
    const availability = await authApi.usernameAvailable(nextUsername);
    const availabilityStatus =
      availability?.data?.status ?? availability?.status ?? "";

    if (availabilityStatus === "taken") {
      setUsernameChangeMessage("error", "该用户名已被占用，请换一个用户名。");
      return;
    }

    if (availabilityStatus === "invalid") {
      setUsernameChangeMessage("error", "用户名格式不符合规则。");
      return;
    }

    setUsernameChangeMessage("pending", "正在更新用户名，请稍候...");

    const response = await authApi.changeUsername({ username: nextUsername });
    const account = response?.data?.account ?? response?.account ?? null;
    const updatedUsername = account?.username ?? nextUsername;

    if (state.user.currentUser) {
      state.user.currentUser.username = updatedUsername;
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

    setUsernameChangeMessage("success", "用户名已更新。");
    window.setTimeout(() => {
      resetUsernameEditor();
    }, 500);
  } catch (error) {
    const payload = error?.payload ?? {};
    const code = payload?.code || payload?.error?.code || error?.code || "";

    if (code === "E_VALIDATION") {
      // 400 时后端在 detail.fields 里写明不合规的具体原因（此处只可能涉及 username）。
      setUsernameChangeMessage(
        "error",
        extractFieldMessages(error)[0] || "用户名格式不符合规则。",
      );
    } else if (code === "E_AUTH") {
      setUsernameChangeMessage("error", "未登录或令牌失效，无法修改用户名。");
    } else if (code === "E_BANNED") {
      setUsernameChangeMessage("error", "账号已被封禁，不能修改用户名。");
    } else if (code === "E_CONFLICT") {
      setUsernameChangeMessage("error", "该用户名已被占用，请换一个用户名。");
    } else {
      setUsernameChangeMessage(
        "error",
        extractErrorMessage(error, "用户名修改失败，请稍后再试。"),
      );
    }
  } finally {
    usernameChangeState.value.submitting = false;
  }
}

// 退出登录（当前设备 / 全部设备）；无论接口成败都会清掉本地用户。
async function handleLogout(allDevices = false) {
  if (logoutSubmitting.value) {
    return;
  }

  logoutSubmitting.value = allDevices ? "all" : "current";
  setAuthMessage(
    "pending",
    `正在${allDevices ? "退出全部设备登录" : "退出登录"}，请稍候...`,
  );
  try {
    if (allDevices) {
      await authApi.logoutAll();
    } else {
      await authApi.logout();
    }
    setAuthMessage(
      "success",
      allDevices ? "已退出全部设备登录。" : "已退出当前设备登录。",
    );
  } catch (error) {
    setAuthMessage(
      "error",
      `退出请求失败：${extractErrorMessage(error, "请稍后重试")}。本地登录状态已清除。`,
    );
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

    <UserTabs />

    <div class="page-shell__body">
      <div
        v-if="state.user.currentUser"
        class="panel-card panel-card--wide account-panel"
      >
        <p class="panel-card__label">当前账户</p>
        <h2>{{ state.user.currentUser.username }}</h2>
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
              logoutSubmitting === "current" ? "退出中，请稍候..." : "退出登录"
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

        <StatusMessage :message="authMessage" :tone="authMessageTone" />

        <div v-if="usernameChangeState.open" class="username-change-form">
          <label class="field">
            <span>新用户名</span>
            <input
              id="rename-username"
              v-model="currentUsernameDraft"
              type="text"
              placeholder="请输入新用户名"
              :aria-describedby="
                usernameChangeStatusMessage
                  ? 'rename-username-status'
                  : undefined
              "
            />
            <NameStatus
              id="rename-username-status"
              :status="usernameChangeStatus"
              :message="usernameChangeStatusMessage"
            />
          </label>

          <StatusMessage
            :message="usernameChangeMessage"
            :tone="usernameChangeMessageTone"
          />

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
              id="register-username"
              v-model="authForm.username"
              type="text"
              placeholder="请输入用户名"
              :aria-describedby="
                usernameStatusMessage ? 'register-username-status' : undefined
              "
            />
            <NameStatus
              id="register-username-status"
              :status="usernameStatus"
              :message="usernameStatusMessage"
            />
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

          <div
            v-if="authMode === 'register' && registerStep === 'verify'"
            class="verification-panel"
          >
            <p class="verification-help">
              验证码已发送到 <strong>{{ sentEmail }}</strong
              >，有效期为 {{ verificationCodeTtlMinutes }} 分钟。
            </p>

            <label class="verification-field">
              <input
                v-model="verificationCode"
                type="text"
                :maxlength="verificationCodeLength"
                :placeholder="`请输入 ${verificationCodeLength} 位验证码`"
              />
            </label>
          </div>

          <div class="auth-footer">
            <button
              class="primary-button"
              type="submit"
              :disabled="authSubmitting"
            >
              {{
                authSubmitting
                  ? authMode === "register"
                    ? registerStep === "verify"
                      ? "验证中，请稍候..."
                      : "发送中，请稍候..."
                    : "登录中，请稍候..."
                  : authMode === "register"
                    ? registerStep === "verify"
                      ? "完成注册"
                      : "发送验证码"
                    : "登录"
              }}
            </button>
            <button
              v-if="authMode === 'register' && registerStep === 'verify'"
              class="text-link-button"
              type="button"
              :disabled="authSubmitting || resendCooldownRemaining > 0"
              @click="resendRegisterCode"
            >
              {{
                resendCooldownRemaining > 0
                  ? `${resendCooldownRemaining} 秒后可重发`
                  : "重新发送验证码"
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

        <StatusMessage :message="authMessage" :tone="authMessageTone" />
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

.account-panel {
  animation: account-panel-in 0.28s ease both;
}

.account-panel > * {
  animation: account-content-in 0.3s ease both;
}

.account-panel > :nth-child(1) {
  animation-delay: 0.05s;
}

.account-panel > :nth-child(2) {
  animation-delay: 0.09s;
}

.account-panel > :nth-child(3) {
  animation-delay: 0.13s;
}

.account-panel > :nth-child(4) {
  animation-delay: 0.17s;
}

.account-panel > :nth-child(5) {
  animation-delay: 0.21s;
}

.account-panel > :nth-child(n + 6) {
  animation-delay: 0.25s;
}

.account-panel > .username-change-form {
  animation-delay: 0.05s;
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

.text-link-button:disabled {
  color: var(--text-dim);
  cursor: not-allowed;
}

@keyframes account-panel-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes account-content-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
