import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { authApi } from "@/api/auth";
import { clearAccessToken } from "@/api/request";
import { useGameState } from "@/composables/useGameState";
// 免密登录 cookie 中的会话信息
async function restoreSessionFromCookie() {
  const { state } = useGameState();

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
