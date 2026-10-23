// 题目结构（GET /api/puzzle/map）的单例状态：桌面卡片、档案页与顶栏进度共用这一份。
//
// 后端只返回「已解锁」的目录与题目，所以这里不存在锁定项：
// 拿不到的 key 就是没解锁（或已停用），前端不做任何本地推算，也不预加载。
import { computed, reactive } from "vue";
import { puzzleApi } from "@/api/puzzle";
import { extractErrorMessage } from "@/api/errors";

const state = reactive({
  loaded: false,
  loading: false,
  error: "",
  folders: [],
  progress: { solvedCount: 0, totalPuzzles: 0 },
});

let inflight = null;

// 题目条目：kind 目前只有 puzzle（resource 为将来的资源型条目预留）。
function toEntry(item) {
  return {
    id: item.key,
    kind: item.kind === "resource" ? "resource" : "puzzle",
    title: item.title,
    ord: item.ord ?? 0,
    renderKind: item.renderKind || "none",
    solved: Boolean(item.solved),
    unlocked: true,
    // map 已按本队进度选好封面（未解主封面 / 已解完成态封面），前端直接渲染
    cover: item.cover ?? null,
  };
}

// 目录：key 为空的题归入服务端下发的「未分组」虚拟目录，这里统一成稳定 id 以便路由。
function toFolder(node) {
  const entries = (node.children ?? []).map(toEntry);
  const solvedCount = entries.filter((entry) => entry.solved).length;
  const puzzleCount = entries.length;
  const completed = Boolean(node.completed);

  return {
    id: node.key || "ungrouped",
    key: node.key ?? "",
    name: node.title || "未分组",
    subtitle: completed
      ? `已通关 · ${puzzleCount} 题`
      : `${solvedCount}/${puzzleCount} 题`,
    completed,
    solvedCount,
    puzzleCount,
    unlocked: true,
    hidden: false,
    entries,
  };
}

export function usePuzzleMap() {
  // 拉取题目结构。force 用于「解出题目后重新拉一次 map」以看到新解锁项。
  function load({ force = false } = {}) {
    if (inflight) return inflight;
    if (state.loaded && !force) return Promise.resolve(state);

    state.loading = true;
    state.error = "";

    inflight = (async () => {
      try {
        const payload = await puzzleApi.getMap();
        const data = payload?.data ?? {};
        state.folders = (data.map?.children ?? []).map(toFolder);
        state.progress = {
          solvedCount: data.progress?.solvedCount ?? 0,
          totalPuzzles: data.progress?.totalPuzzles ?? 0,
        };
        state.loaded = true;
      } catch (error) {
        // 门禁类错误（未入队 / 未确认参赛 / 未开赛 / 队伍封禁）文案由后端给出，直接展示。
        state.error = extractErrorMessage(error, "题目列表加载失败");
        state.folders = [];
        state.loaded = false;
      } finally {
        state.loading = false;
        inflight = null;
      }
      return state;
    })();

    return inflight;
  }

  // 登出 / 换账号时清空，避免把上一个账号的解锁进度留在界面上。
  function reset() {
    state.loaded = false;
    state.loading = false;
    state.error = "";
    state.folders = [];
    state.progress = { solvedCount: 0, totalPuzzles: 0 };
    inflight = null;
  }

  function findFolder(folderId) {
    return state.folders.find((folder) => folder.id === folderId) ?? null;
  }

  function findEntry(entryId) {
    for (const folder of state.folders) {
      const hit = folder.entries.find((entry) => entry.id === entryId);
      if (hit) return hit;
    }
    return null;
  }

  return {
    folders: computed(() => state.folders),
    progress: computed(() => state.progress),
    loaded: computed(() => state.loaded),
    loading: computed(() => state.loading),
    error: computed(() => state.error),
    load,
    refresh: () => load({ force: true }),
    reset,
    findFolder,
    findEntry,
  };
}

export default usePuzzleMap;
