<script setup>
// 伪桌面布局：顶部设置栏 + 主界面（档案） + 右侧线索栏。
import { computed, ref } from "vue";
import TopBar from "@/components/TopBar.vue";
import ClueBoard from "@/components/ClueBoard.vue";
import DragGhost from "@/components/DragGhost.vue";
import DesktopView from "@/views/DesktopView.vue";
import FolderView from "@/views/FolderView.vue";
import RegisterView from "@/views/RegisterView.vue";
import TeamView from "@/views/TeamView.vue";
import { FOLDER_BY_ID } from "@/config/folders";

const activeFolderId = ref(null);
const activeFeature = ref(null);

const activeFolder = computed(() =>
    activeFolderId.value ? (FOLDER_BY_ID.get(activeFolderId.value) ?? null) : null,
);

function openFolder(folderId) {
    activeFolderId.value = folderId;
    activeFeature.value = null;
}

function openFeature(featureName) {
    activeFeature.value = featureName;
    activeFolderId.value = null;
}

function backToDesktop() {
    activeFolderId.value = null;
    activeFeature.value = null;
}
</script>

<template>
    <div class="app">
        <TopBar
            :in-folder="Boolean(activeFolder) || Boolean(activeFeature)"
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
