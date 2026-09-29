<script setup>
// 伪桌面布局：顶部设置栏 + 主界面（档案） + 右侧线索栏。
import { computed, ref } from "vue";
import TopBar from "@/components/TopBar.vue";
import ClueBoard from "@/components/ClueBoard.vue";
import DragGhost from "@/components/DragGhost.vue";
import DesktopView from "@/views/DesktopView.vue";
import FolderView from "@/views/FolderView.vue";
import { FOLDER_BY_ID } from "@/config/folders";

// 当前打开的档案；为空即主界面
const activeFolderId = ref(null);

const activeFolder = computed(() =>
    activeFolderId.value ? (FOLDER_BY_ID.get(activeFolderId.value) ?? null) : null,
);

function openFolder(folderId) {
    activeFolderId.value = folderId;
}

function backToDesktop() {
    activeFolderId.value = null;
}
</script>

<template>
    <div class="app">
        <TopBar :in-folder="Boolean(activeFolder)" @go-desktop="backToDesktop" />

        <div class="app-body">
            <main class="app-main">
                <FolderView
                    v-if="activeFolder"
                    :key="activeFolder.id"
                    :folder="activeFolder"
                    @close="backToDesktop"
                />
                <DesktopView v-else @open="openFolder" />
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
