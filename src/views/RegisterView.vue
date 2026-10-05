<script setup>
import { computed, ref } from "vue";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";

const emit = defineEmits(["close"]);

const { state, loginUser, logoutUser } = useGameState();
const authMode = ref("login");
const authForm = ref({
    username: "",
    nickname: "",
    email: "",
    password: "",
    confirmPassword: "",
});
const authMessage = ref("");

const currentUserEmail = computed(() => state.user.currentUser?.email || "");

function switchAuthMode(mode) {
    authMode.value = mode;
    authMessage.value = "";
}

function validateRegisterForm() {
    const username = String(authForm.value.username ?? "").trim();
    const nickname = String(authForm.value.nickname ?? "").trim();
    const email = String(authForm.value.email ?? "").trim();
    const password = String(authForm.value.password ?? "").trim();
    const confirmPassword = String(authForm.value.confirmPassword ?? "").trim();

    if (!username || !email || !password) {
        authMessage.value = "用户名、邮箱和密码不能为空。";
        return null;
    }

    if (!nickname) {
        authMessage.value = "昵称不能为空。";
        return null;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        authMessage.value = "请输入有效的邮箱地址。";
        return null;
    }

    if (!confirmPassword) {
        authMessage.value = "确认密码不能为空。";
        return null;
    }

    if (password !== confirmPassword) {
        authMessage.value = "两次输入的密码不一致。";
        return null;
    }

    const duplicateUser = state.user.users.some(
        (user) => user.username.toLowerCase() === username.toLowerCase(),
    );
    const duplicateEmail = state.user.users.some(
        (user) => String(user.email ?? "").toLowerCase() === email.toLowerCase(),
    );

    if (duplicateUser) {
        authMessage.value = "该用户名已存在，请更换用户名。";
        return null;
    }

    if (duplicateEmail) {
        authMessage.value = "该邮箱已被注册，请更换邮箱。";
        return null;
    }

    return { username, nickname, email, password };
}

function startRegisterVerification() {
    const validated = validateRegisterForm();
    if (!validated) {
        return;
    }

    const { username, nickname, email, password } = validated;
    const generatedCode = String(Math.floor(100000 + Math.random() * 900000));

    state.user.auth.verificationRequired = true;
    state.user.auth.verificationMode = "register";
    state.user.auth.generatedCode = generatedCode;
    state.user.auth.pendingRegister = { username, nickname, email, password };
    state.user.auth.pendingLogin = null;

    authMessage.value = `验证码已发送至 ${email}，验证码为 ${generatedCode}（演示环境）。`;
    router.goToRoute("/verification");
}

function handleAuthSubmit() {
    if (authMode.value === "register") {
        startRegisterVerification();
        return;
    }

    const username = String(authForm.value.username ?? "").trim();
    const password = String(authForm.value.password ?? "").trim();

    if (!username) {
        authMessage.value = "用户名不能为空。";
        return;
    }

    if (!password) {
        authMessage.value = "密码不能为空。";
        return;
    }

    const result = loginUser({
        username,
        password,
    });

    authMessage.value = result.message;
    if (result.ok) {
        authForm.value = { username: "", nickname: "", email: "", password: "", confirmPassword: "" };
    }
}

function handleLogout() {
    logoutUser();
    authMessage.value = "已退出登录。";
}
</script>

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
                <button class="secondary-button" type="button" @click="handleLogout">
                    退出登录
                </button>
            </div>

            <div v-else class="panel-card panel-card--wide">
                <div class="auth-tabs">
                    <button
                        :class="{ 'is-active': authMode === 'login' }"
                        type="button"
                        @click="switchAuthMode('login')"
                    >
                        登录
                    </button>
                    <button
                        :class="{ 'is-active': authMode === 'register' }"
                        type="button"
                        @click="switchAuthMode('register')"
                    >
                        注册
                    </button>
                </div>

                <form class="auth-form" @submit.prevent="handleAuthSubmit">
                    <label>
                        <span>用户名</span>
                        <input v-model="authForm.username" type="text" placeholder="请输入用户名" />
                    </label>

                    <label v-if="authMode === 'register'">
                        <span>昵称</span>
                        <input v-model="authForm.nickname" type="text" placeholder="请输入显示昵称" />
                    </label>

                    <label v-if="authMode === 'register'">
                        <span>邮箱</span>
                        <input v-model="authForm.email" type="text" placeholder="请输入邮箱地址" />
                    </label>

                    <label>
                        <span>密码</span>
                        <input v-model="authForm.password" type="password" placeholder="请输入密码" />
                    </label>

                    <label v-if="authMode === 'register'">
                        <span>确认密码</span>
                        <input v-model="authForm.confirmPassword" type="password" placeholder="再次输入密码" />
                    </label>

                    <button class="primary-button" type="submit">
                        {{ authMode === "register" ? "发送验证码" : "登录" }}
                    </button>
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

.helper-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-dim);
}
</style>
