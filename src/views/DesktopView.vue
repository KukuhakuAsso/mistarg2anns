<script setup>
// 主界面：桌面式启动页，保留档案柜入口，并提供常用功能快捷方式。
import { computed, ref } from "vue";
import DesktopAppItem from "@/components/DesktopAppItem.vue";
import FolderItem from "@/components/FolderItem.vue";
import UserPanel from "@/components/UserPanel.vue";
import { useGameState } from "@/composables/useGameState";
import { DESKTOP_APPS } from "@/config/desktop";
import { MAIN_FOLDERS } from "@/config/folders";

const emit = defineEmits(["open", "open-page"]);

const { state, folderStates, unlockedCount, completedCount, markFolderVisited } = useGameState();
const showUserPanel = ref(false);
const userPanelPosition = ref({ x: 0, y: 0 });
const activeMenu = ref({
    appId: null,
    title: "用户",
    subtitle: "个人终端",
    items: [],
    position: { x: 0, y: 0 },
});

const menuMap = {
    user: {
        title: "用户",
        subtitle: "个人终端",
        items: [
            { id: "team", name: "我的队伍", detail: "当前组队情况" },
            { id: "register", name: "注册", detail: "登录 / 注册" },
            { id: "messages", name: "站内信", detail: `${state.unreadMessages ?? 0} 条未读` },
            // { id: "settings", name: "设置", detail: "界面 · 通知" },
            // { id: "tips", name: "tips点", detail: `${state.tipPoints} 点可用` },
            { id: "milestone", name: "里程碑", detail: `${completedCount.value}/${MAIN_FOLDERS.length} 已完成` },
        ],
    },
    archive: {
        title: "档案",
        subtitle: "主线数据库",
        items: [
            { id: "archive-search", name: "快速检索", detail: "待补充" },
            { id: "archive-summary", name: "档案摘要", detail: "待补充" },
            { id: "archive-logs", name: "历史记录", detail: "待补充" },
        ],
    },
    entertainment: {
        title: "娱乐",
        subtitle: "休闲入口",
        items: [
            { id: "entertainment-1", name: "功能一", detail: "待补充" },
            { id: "entertainment-2", name: "功能二", detail: "待补充" },
            { id: "entertainment-3", name: "功能三", detail: "待补充" },
        ],
    },
    communication: {
        title: "通讯",
        subtitle: "联络中心",
        items: [
            { id: "communication-1", name: "功能一", detail: "待补充" },
            { id: "communication-2", name: "功能二", detail: "待补充" },
            { id: "communication-3", name: "功能三", detail: "待补充" },
        ],
    },
    tools: {
        title: "工具",
        subtitle: "处理中心",
        items: [
            { id: "toolbox", name: "常用工具", detail: "网页与资料检索" },
            { id: "timeline", name: "时间线", detail: "剧情事件时间轴" },
        ],
    },
};

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

function hintOf(folder) {
    if (folder.unlocked) return "";
    if (folder.hidden) {
        return `完成全部 ${MAIN_FOLDERS.length} 份档案后解锁`;
    }

    const index = MAIN_FOLDERS.findIndex((item) => item.id === folder.id);
    const previous = MAIN_FOLDERS[index - 1];
    return previous ? `完成「${previous.name}」后解锁` : "可直接进入";
}

function handleFolderOpen(folderId) {
    markFolderVisited(folderId);
    emit("open", folderId);
}

function closeUserPanel() {
    showUserPanel.value = false;
}

function openShortcut(appId, event) {
    const button = event?.currentTarget;
    const rect = button?.getBoundingClientRect?.();
    const panelWidth = 280;

    if (rect) {
        const x = Math.min(
            Math.max(rect.left, 12),
            window.innerWidth - panelWidth - 12,
        );
        const y = Math.min(Math.max(rect.bottom + 10, 12), window.innerHeight - 220);
        userPanelPosition.value = { x, y };
    }
    if (appId === "archive") {
        emit("open-page", "archive");
        return;
    }

    if (appId === "communication") {
        emit("open-page", "communication");
        return;
    }

    const menuConfig = menuMap[appId];
    if (!menuConfig) {
        return;
    }

    const isSameMenu = showUserPanel.value && activeMenu.value.appId === appId;
    if (isSameMenu) {
        closeUserPanel();
        return;
    }

    activeMenu.value = {
        appId,
        title: menuConfig.title,
        subtitle: menuConfig.subtitle,
        items: menuConfig.items,
        position: userPanelPosition.value,
    };
    showUserPanel.value = true;
}

function handleUserMenuClick(item) {
    if (!item) return;


    console.log(item);
    closeUserPanel();

    if (item.id === "register") {
        emit("open-page", "register");
        return;
    }

    if (item.id === "team") {
        emit("open-page", "team");
        return;
    }

    if (item.id === "messages") {
        emit("open-page", "messages");
        return;
    }

    if (item.id === "milestone") {
        emit("open-page", "milestone");
        return;
    }

    if (item.id === "archive-search") {
        emit("open-page", "archive");
        return;
    }

    if (item.id === "communication-1" || item.id === "communication-2" || item.id === "communication-3") {
        emit("open-page", "communication");
        return;
    }

    if (item.id === "toolbox") {
        emit("open-page", "tools");
        return;
    }

    if (item.id === "timeline") {
        emit("open-page", "timeline");
        return;
    }

    if (item.id === "settings") {
        emit("open-page", "messages");
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
