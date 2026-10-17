import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { authApi } from "@/api/auth";
import { clearAccessToken } from "@/api/request";
import { useGameState } from "@/composables/useGameState";
// 免密登录 cookie 中的会话信息
async function restoreSessionFromCookie() {
  const { state, applyAccountSnapshot } = useGameState();

  try {
    const session = await authApi.bootstrapSession();
    const account = session?.account ?? null;

    if (!account) {
      state.user.currentUser = null;
      return;
    }

    state.user.currentUser = {
      id: account.id ?? null,
      username: account.username ?? account.player_no ?? "",
      email: account.email ?? "",
      playerNo: account.player_no ?? "",
      role: account.role ?? "player",
      team: account.team ?? null,
    };
    // 会话快照里若已带封禁（account.banned），首屏就先标记好：
    // 既避免「先渲染旧页面再跳申诉页」，也让后续 /me/status 不再触发强制登出
    applyAccountSnapshot(account);
  } catch (error) {
    state.user.currentUser = null;
    clearAccessToken();
  }
}

async function startApplication() {
  await restoreSessionFromCookie();
  createApp(App).mount("#app");
}

startApplication();
