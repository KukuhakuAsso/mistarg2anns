// 极简手写 hash 路由（未引入 vue-router）：以 location.hash 当作路径，
// currentRoute 是全局响应式状态，App 依据它决定渲染哪个视图。
import { reactive } from "vue";

// 当前路由；全应用共享这一份，且只由本模块写入。
const currentRoute = reactive({
  name: "desktop",
  path: "/",
  params: {},
});

// 把各种写法的路径统一成以 / 开头的形式，便于后续比对：
// "#/team" / "#team" / "team" 都归一化为 "/team"；空值、"#" 与非字符串回落到 "/"。
function normalizePath(input) {
  if (typeof input !== "string") return "/";
  const trimmed = input.trim();

  if (!trimmed || trimmed === "#") return "/";
  if (trimmed.startsWith("#/")) return trimmed.slice(1);
  if (trimmed.startsWith("#")) return `/${trimmed.slice(1)}`;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed}`;
}

// 功能页名单：路由名与路径片段一致（"team" ⇄ "/team"），是这份映射的唯一来源 ——
// 路由解析、App 的视图白名单与菜单跳转都读它，新增功能页只需在这里加一项。
export const FEATURE_ROUTES = new Set([
  "register",
  "team",
  "messages",
  "milestone",
  "archive",
  "communication",
  "tools",
  "timeline",
  "verification",
  "password",
  "forgot",
]);

// 路由表：路径 → { name, path, params }。
// 这里是声明路由的唯一位置，未匹配的路径一律回落到桌面而不是报错。
function resolveRoute(path) {
  const normalized = normalizePath(path);

  if (normalized === "/") {
    return { name: "desktop", path: "/", params: {} };
  }

  // 功能页：名字即路径片段（/team → "team"），名单见 FEATURE_ROUTES。
  const featureName = normalized.slice(1);
  if (FEATURE_ROUTES.has(featureName)) {
    return { name: featureName, path: normalized, params: {} };
  }

  // 唯一带参数的路由：#/folder/:folderId。
  const folderMatch = normalized.match(/^\/folder\/([^/]+)$/);
  if (folderMatch) {
    return {
      name: "folder",
      path: normalized,
      params: { folderId: folderMatch[1] },
    };
  }

  // 兜底：未知路径按桌面处理。
  return { name: "desktop", path: "/", params: {} };
}

// 从当前 location.hash 反解路由，并写回响应式状态。
function syncFromLocation() {
  const path = window.location.hash.replace(/^#/, "") || "/";
  const nextRoute = resolveRoute(path);
  currentRoute.name = nextRoute.name;
  currentRoute.path = nextRoute.path;
  currentRoute.params = nextRoute.params;
}

// 跳转到目标路径。改 hash 只会异步触发 hashchange，所以这里再主动同步一次，
// 保证 goToRoute 返回时 currentRoute 已是最新值（重复同步是幂等的）。
function goToRoute(target) {
  const nextPath = normalizePath(target);
  // 桌面统一用空 hash（形如 "…/#"），其余用 "#/path"。
  const nextHash = nextPath === "/" ? "" : `#${nextPath}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
  syncFromLocation();
}

// 模块加载即完成初始化（无 window 时跳过）：
// 补齐初始 hash、同步一次当前路由，并监听后续 hash 变化（前进/后退、手改地址都会走到这里）。
if (typeof window !== "undefined") {
  if (!window.location.hash) {
    window.location.hash = "/";
  }
  syncFromLocation();
  window.addEventListener("hashchange", syncFromLocation, { passive: true });
}

// 对外接口：读 currentRoute 判断当前页面，用 goToRoute / backToDesktop 导航。
export const router = {
  currentRoute,
  goToRoute,
  // 回到桌面（等价于 goToRoute("/")）。
  backToDesktop() {
    goToRoute("/");
  },
};
