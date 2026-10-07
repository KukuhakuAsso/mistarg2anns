import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { authApi } from "@/api/auth";
import { clearAccessToken } from "@/api/request";
import { useGameState } from "@/composables/useGameState";

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
      nickname: account.nickname ?? account.username ?? account.player_no ?? "",
      email: account.email ?? "",
      player_no: account.player_no ?? "",
      role: account.role ?? "player",
      team: account.team ?? null,
    };
  } catch (error) {
    state.user.currentUser = null;
    clearAccessToken();
  }
}

const app = createApp(App);
app.mount("#app");
restoreSessionFromCookie();
