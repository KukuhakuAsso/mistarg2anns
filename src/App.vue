<script setup>
// 伪桌面布局：顶部设置栏 + 主界面（档案） + 右侧线索栏。
import { computed } from "vue";
import TopBar from "@/components/TopBar.vue";
import ClueBoard from "@/components/ClueBoard.vue";
import DragGhost from "@/components/DragGhost.vue";
import DesktopView from "@/views/DesktopView.vue";
import FolderView from "@/views/FolderView.vue";
import RegisterView from "@/views/RegisterView.vue";
import TeamView from "@/views/TeamView.vue";
import MessageView from "@/views/MessageView.vue";
import MilestoneView from "@/views/MilestoneView.vue";
import ArchiveSearchView from "@/views/ArchiveSearchView.vue";
import { FOLDER_BY_ID } from "@/config/folders";
import { router } from "@/router";

const currentRoute = computed(() => router.currentRoute);

const activeFolder = computed(() =>
    currentRoute.value.name === "folder"
        ? FOLDER_BY_ID.get(currentRoute.value.params.folderId) ?? null
        : null,
);

const activeFeature = computed(() => {
    const routeName = currentRoute.value.name;
    if (
        routeName === "register" ||
        routeName === "team" ||
        routeName === "messages" ||
        routeName === "milestone" ||
        routeName === "archive"
    ) {
        return routeName;
    }
    return null;
});

const inFolder = computed(
    () => currentRoute.value.name !== "desktop" && currentRoute.value.name !== "",
);

function openFolder(folderId) {
    router.goToRoute(`/folder/${folderId}`);
}

function openFeature(featureName) {
    const routeMap = {
        register: "/register",
        team: "/team",
        messages: "/messages",
        milestone: "/milestone",
        archive: "/archive",
    };

    if (routeMap[featureName]) {
        router.goToRoute(routeMap[featureName]);
    }
}

function backToDesktop() {
    router.backToDesktop();
}
</script>

<template>
    <div class="app">
        <TopBar
            :in-folder="inFolder"
            @go-desktop="backToDesktop"
        />

        <div class="app-body">
            <main class="app-main">
                <FolderView
                    v-if="activeFolder"
                    :key="activeFolder.id"
                    :folder="activeFolder"
                    @close="backToDesktop"
                />
                <RegisterView
                    v-else-if="activeFeature === 'register'"
                    @close="backToDesktop"
                />
                <TeamView
                    v-else-if="activeFeature === 'team'"
                    @close="backToDesktop"
                />
                <MessageView
                    v-else-if="activeFeature === 'messages'"
                    @close="backToDesktop"
                />
                <MilestoneView
                    v-else-if="activeFeature === 'milestone'"
                    @close="backToDesktop"
                />
                <ArchiveSearchView
                    v-else-if="activeFeature === 'archive'"
                    @close="backToDesktop"
                />
                <DesktopView v-else @open="openFolder" @open-page="openFeature" />
            </main>

            <ClueBoard />
        </div>

        <DragGhost />
    </div>
</template>

<style scoped>
.app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
}

.app-body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
}

.app-main {
    flex: 1;
    min-width: 0;
    padding: 24px 28px 32px;
    overflow-y: auto;
}
</style>
