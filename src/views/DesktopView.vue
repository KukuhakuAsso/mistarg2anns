<script setup>
// 主界面：桌面式启动页，保留档案柜入口，并提供常用功能快捷方式。
import { computed, ref } from "vue";
import DesktopAppItem from "@/components/DesktopAppItem.vue";
import FolderItem from "@/components/FolderItem.vue";
import UserPanel from "@/components/UserPanel.vue";
import { useGameState } from "@/composables/useGameState";
import { DESKTOP_APPS, createDesktopMenu } from "@/config/desktop";
import { MAIN_FOLDERS } from "@/config/folders";

const emit = defineEmits(["open", "open-page"]);

const { state, folderStates, completedCount, markFolderVisited } = useGameState();
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
        completedCount: completedCount.value,
        folderTotal: MAIN_FOLDERS.length,
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
    ...folderStates.value.map((folder) => ({
        id: folder.id,
        kind: "folder",
        name: folder.name,
        icon: "folder",
        accent: folder.completed ? "amber" : "slate",
        description: folder.unlocked ? `${folder.puzzleCount} 题 · ${folder.clueCount} 线索` : hintOf(folder),
        folder,
    })),
]);
// 根据文件夹状态生成提示信息的函数。
function hintOf(folder) {
    if (folder.unlocked) return "";
    if (folder.hidden) {
        return `完成全部 ${MAIN_FOLDERS.length} 份档案后解锁`;
    }

    const index = MAIN_FOLDERS.findIndex((item) => item.id === folder.id);
    const previous = MAIN_FOLDERS[index - 1];
    return previous ? `完成「${previous.name}」后解锁` : "可直接进入";
}
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
        const y = Math.min(Math.max(rect.bottom + 10, 12), window.innerHeight - 220);
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
        <!-- <header class="desktop__head">
            <div>
                <p class="desktop__eyebrow">工作台</p>
                <h1 class="desktop__title">档案终端</h1>
            </div>
            <span class="desktop__status">
                已解锁 {{ unlockedCount }}/{{ folderStates.length }}
            </span>
        </header> -->

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
                        :hint="hintOf(item.folder)"
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

        <!-- <section class="desktop__archive-panel">
            <header class="desktop__section-head">
                <h2>档案柜</h2>
                <span>已完成 {{ completedCount }}/{{ MAIN_FOLDERS.length }}</span>
            </header>

            <p class="desktop__desc">
                共 {{ folderStates.length }} 份档案，按进度依次解锁。
                已解锁 {{ unlockedCount }} 份，已完成 {{ completedCount }} 份。
            </p>

            
        </section> -->
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

</style>
