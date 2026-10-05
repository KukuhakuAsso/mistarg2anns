import { reactive } from "vue";

const currentRoute = reactive({
  name: "desktop",
  path: "/",
  params: {},
});

function normalizePath(input) {
  if (typeof input !== "string") return "/";
  const trimmed = input.trim();

  if (!trimmed || trimmed === "#") return "/";
  if (trimmed.startsWith("#/")) return trimmed.slice(1);
  if (trimmed.startsWith("#")) return `/${trimmed.slice(1)}`;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed}`;
}

function resolveRoute(path) {
  const normalized = normalizePath(path);

  if (normalized === "/") {
    return { name: "desktop", path: "/", params: {} };
  }

  if (normalized === "/register") {
    return { name: "register", path: "/register", params: {} };
  }

  if (normalized === "/team") {
    return { name: "team", path: "/team", params: {} };
  }

  if (normalized === "/messages") {
    return { name: "messages", path: "/messages", params: {} };
  }

  if (normalized === "/milestone") {
    return { name: "milestone", path: "/milestone", params: {} };
  }

  if (normalized === "/archive") {
    return { name: "archive", path: "/archive", params: {} };
  }

  if (normalized === "/communication") {
    return { name: "communication", path: "/communication", params: {} };
  }

  if (normalized === "/tools") {
    return { name: "tools", path: "/tools", params: {} };
  }

  if (normalized === "/timeline") {
    return { name: "timeline", path: "/timeline", params: {} };
  }

  const folderMatch = normalized.match(/^\/folder\/([^/]+)$/);
  if (folderMatch) {
    return {
      name: "folder",
      path: normalized,
      params: { folderId: folderMatch[1] },
    };
  }

  return { name: "desktop", path: "/", params: {} };
}

function syncFromLocation() {
  const path = window.location.hash.replace(/^#/, "") || "/";
  const nextRoute = resolveRoute(path);
  currentRoute.name = nextRoute.name;
  currentRoute.path = nextRoute.path;
  currentRoute.params = nextRoute.params;
}

function goToRoute(target) {
  const nextPath = normalizePath(target);
  const nextHash = nextPath === "/" ? "" : `#${nextPath}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
  syncFromLocation();
}

if (typeof window !== "undefined") {
  if (!window.location.hash) {
    window.location.hash = "/";
  }
  syncFromLocation();
  window.addEventListener("hashchange", syncFromLocation, { passive: true });
}

export const router = {
  currentRoute,
  goToRoute,
  backToDesktop() {
    goToRoute("/");
  },
};
