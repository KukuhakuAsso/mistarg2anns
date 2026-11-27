<script setup>
// 主界面：桌面式启动页，保留档案柜入口，并提供常用功能快捷方式。
import { computed, ref } from "vue";
import DesktopAppItem from "@/components/DesktopAppItem.vue";
import FolderItem from "@/components/FolderItem.vue";
import UserPanel from "@/components/UserPanel.vue";
import { useGameState } from "@/composables/useGameState";
import { usePuzzleMap } from "@/composables/usePuzzleMap";
import { DESKTOP_APPS, createDesktopMenu } from "@/config/desktop";

const emit = defineEmits(["open", "open-page"]);

const { state, markFolderVisited } = useGameState();
// 档案（stage1 目录）完全由 GET /api/puzzle/map 决定
const { folders, progress, load, loading, error, loaded } = usePuzzleMap();
// 未登录时不拉取（否则会得到一串 401）；登录后由 App.vue 统一拉取，
// 这里只在「回到桌面时还没有数据」的场合补一次（例如刚加入队伍拿到取题资格）。
if (state.user.currentUser && !loaded.value && !error.value) {
  load();
}

// 右下角浮层同时承载「加载中」与「加载失败」两种状态（两者互斥）。
const showError = computed(() =>
  Boolean(error.value && state.user.currentUser),
);
const showUserPanel = ref(false);
const userPanelPosition = ref({ x: 0, y: 0 });
const activeMenu = ref({
  appId: null,
  title: "用户",
  subtitle: "个人终端",
  items: [],
  position: { x: 0, y: 0 },
});

// 菜单内容按当前进度动态生成：未读条数与完成进度变化时会重新计算。
const menuMap = computed(() =>
  createDesktopMenu({
    unreadMessages: state.unreadMessages ?? 0,
    completedCount: progress.value.solvedCount,
    folderTotal: progress.value.totalPuzzles,
  }),
);
// 桌面卡片数据，根据应用和文件夹状态动态生成。
const desktopCards = computed(() => [
  ...DESKTOP_APPS.map((app) => ({
    id: app.id,
    kind: "app",
    name: app.name,
    icon: app.icon,
    accent: app.accent,
    description: app.description,
  })),
  ...folders.value.map((folder) => ({
    id: folder.id,
    kind: "folder",
    name: folder.name,
    icon: "folder",
    accent: folder.completed ? "amber" : "slate",
    description: folder.subtitle,
    // 「新文件」角标靠 visited 字段判断
    folder: {
      ...folder,
      visited: state.visitedFolders.includes(folder.id),
    },
  })),
]);
// 处理文件夹打开事件。
function handleFolderOpen(folderId) {
  markFolderVisited(folderId);
  emit("open", folderId);
}
// 关闭用户面板。
function closeUserPanel() {
  showUserPanel.value = false;
}
// 处理桌面快捷方式点击事件。
function openShortcut(appId, event) {
  const button = event?.currentTarget;
  const rect = button?.getBoundingClientRect?.();
  const panelWidth = 280;
  // 计算面板位置，确保不超出窗口边界。
  if (rect) {
    const x = Math.min(
      Math.max(rect.left, 12),
      window.innerWidth - panelWidth - 12,
    );
    const y = Math.min(
      Math.max(rect.bottom + 10, 12),
      window.innerHeight - 220,
    );
    userPanelPosition.value = { x, y };
  }
  // 打开应用对应的页面，注意这里这两个应用没有设置面板。
  if (appId === "archive") {
    emit("open-page", "archive");
    return;
  }
  if (appId === "communication") {
    emit("open-page", "communication");
    return;
  }
  // 打开自定义菜单面板。
  const menuConfig = menuMap.value[appId];
  if (!menuConfig) {
    return;
  }
  // 如果当前已经打开的是同一个菜单，则关闭面板。
  const isSameMenu = showUserPanel.value && activeMenu.value.appId === appId;
  if (isSameMenu) {
    closeUserPanel();
    return;
  }
  // 否则，设置当前活动菜单并显示用户面板。

  activeMenu.value = {
    appId,
    title: menuConfig.title,
    subtitle: menuConfig.subtitle,
    items: menuConfig.items,
    position: userPanelPosition.value,
  };
  showUserPanel.value = true;
}
// 处理用户面板菜单项点击事件。
function handleUserMenuClick(item) {
  if (!item) {
    return;
  }

  closeUserPanel();

  if (item.page) {
    emit("open-page", item.page);
  }
}
</script>

<template>
  <section class="desktop">
    <!-- 题目结构状态（加载中 / 加载失败）：统一在右下角浮层显示，不挤占桌面布局 -->
    <Transition name="toast">
      <div
        v-if="loading || showError"
        class="desktop-toast"
        :class="showError ? 'desktop-toast--error' : 'desktop-toast--loading'"
        :role="showError ? 'alert' : 'status'"
      >
        <div class="desktop-toast__head">
          <span class="desktop-toast__dot" aria-hidden="true" />
          <strong class="desktop-toast__title">
            {{ showError ? "题目结构加载失败" : "正在加载题目结构…" }}
          </strong>
        </div>
        <template v-if="showError">
          <p class="desktop-toast__text">{{ error }}</p>
          <button
            class="desktop-toast__retry"
            type="button"
            @click="load({ force: true })"
          >
            重试
          </button>
        </template>
      </div>
    </Transition>

    <div class="desktop__launcher">
      <ul class="desktop__grid">
        <li
          v-for="item in desktopCards"
          :key="item.id"
          class="desktop__card-slot"
        >
          <DesktopAppItem
            v-if="item.kind === 'app'"
            :app="item"
            class="desktop-card"
            @open="openShortcut"
          />

          <FolderItem
            v-else
            :folder="item.folder"
            class="desktop-card"
            @open="handleFolderOpen($event)"
          />
        </li>
      </ul>
    </div>

    <UserPanel
      :open="showUserPanel"
      :title="activeMenu.title"
      :subtitle="activeMenu.subtitle"
      :items="activeMenu.items"
      :position="activeMenu.position"
      @close="closeUserPanel"
      @item-click="handleUserMenuClick"
    />
  </section>
</template>

<style scoped>
.desktop {
  display: flex;
  flex-direction: column;
  gap: 22px;
  height: 100%;
  min-height: 0;
}

/* 右下角状态浮层（加载中 / 加载失败）：与桌面内容分离，不随视图滚动 */
.desktop-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(340px, calc(100vw - 32px));
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.desktop-toast--error {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
}

.desktop-toast__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.desktop-toast__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-dim);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-dim) 18%, transparent);
}

.desktop-toast--error .desktop-toast__dot {
  background: var(--danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent);
}

.desktop-toast--loading .desktop-toast__dot {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  animation: desktop-toast-pulse 1.2s ease-in-out infinite;
}

.desktop-toast__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.desktop-toast--error .desktop-toast__title {
  color: var(--danger);
}

.desktop-toast__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
  overflow-wrap: anywhere;
}

.desktop-toast__retry {
  align-self: flex-end;
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-alt);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.desktop-toast__retry:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.desktop__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 4px 0;
}

.desktop__eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.desktop__title {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
}

.desktop__status {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.02);
}

.desktop__launcher {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 8px 4px 0;
  overflow: hidden;
}

.desktop__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
  align-content: flex-start;
  gap: 12px;
  width: 100%;
  min-height: 0;
  list-style: none;
  padding: 0;
  margin: 0;
  overflow: auto;
}

.desktop__card-slot {
  display: flex;
  width: 100%;
  min-width: 136px;
  min-height: 96px;
}

.desktop-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 96px;
  padding: 12px 14px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.desktop__archive-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 8px;
}

.desktop__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
}

.desktop__section-head h2 {
  margin: 0;
  font-size: 18px;
}

.desktop__section-head span {
  font-size: 12px;
  color: var(--text-dim);
}

.desktop__desc {
  margin: 0;
  padding: 0 4px;
  font-size: 13px;
  color: var(--text-dim);
}

@keyframes desktop-toast-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}
</style>
