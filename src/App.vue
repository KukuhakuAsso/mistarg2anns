<script setup>
// 伪桌面布局：顶部设置栏 + 主界面（档案） + 右侧线索栏。
import { computed, watch } from "vue";
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
import CommunicationView from "@/views/CommunicationView.vue";
import ToolsView from "@/views/ToolsView.vue";
import TimelineView from "@/views/TimelineView.vue";
import VerificationView from "@/views/VerificationView.vue";
import ChangePasswordView from "@/views/ChangePasswordView.vue";
import ForgotPasswordView from "@/views/ForgotPasswordView.vue";
import { FOLDER_BY_ID } from "@/config/folders";
import { FEATURE_ROUTES, router } from "@/router";
import { useGameState } from "@/composables/useGameState";

const { state } = useGameState();
// 当前路由对象（hash 路由维护的全局响应式状态），下面的派生判断都基于它。
const currentRoute = computed(() => router.currentRoute);

// 访问守卫：未登录时只放行公开路由，其他路由一律送回登录页；immediate 让首屏也走一次判断。
watch(
    () => [currentRoute.value.name, state.user.currentUser],
    ([routeName, currentUser]) => {
        // 未登录也能访问的路由：桌面、登录注册、邮箱验证、找回密码。
        const allowedPublicRoutes = new Set(["desktop", "register", "verification", "forgot"]);
        if (!currentUser && !allowedPublicRoutes.has(routeName)) {
            router.goToRoute("/register");
        }
    },
    { immediate: true },
);

// 当前打开的档案：仅 #/folder/:id 命中，未知 id 视为未打开。
const activeFolder = computed(() =>
    currentRoute.value.name === "folder"
        ? FOLDER_BY_ID.get(currentRoute.value.params.folderId) ?? null
        : null,
);

// 当前功能页名（模板据此挑选视图组件）；只有登记在 router 名单里的才算，其余返回 null 落回桌面。
const activeFeature = computed(() =>
    FEATURE_ROUTES.has(currentRoute.value.name) ? currentRoute.value.name : null,
);

// 是否处于某个页面内部（非桌面），用于让 TopBar 显示返回入口。
const inFolder = computed(
    () => currentRoute.value.name !== "desktop" && currentRoute.value.name !== "",
);

// 打开指定档案。
function openFolder(folderId) {
    router.goToRoute(`/folder/${folderId}`);
}

// 打开功能页（功能名即路径片段）；未登记的功能名静默忽略。
function openFeature(featureName) {
    if (FEATURE_ROUTES.has(featureName)) {
        router.goToRoute(`/${featureName}`);
    }
}

// 返回桌面。
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
                <!-- 视图切换优先级：档案页 > 功能页（activeFeature）> 桌面 -->
                <FolderView
                    v-if="activeFolder"
                    :key="activeFolder.id"
                    :folder="activeFolder"
                    @close="backToDesktop"
                />
                <RegisterView
                    v-else-if="activeFeature === 'register'"
                />
                <TeamView
                    v-else-if="activeFeature === 'team'"
                />
                <MessageView
                    v-else-if="activeFeature === 'messages'"
                />
                <MilestoneView
                    v-else-if="activeFeature === 'milestone'"
                />
                <ArchiveSearchView
                    v-else-if="activeFeature === 'archive'"
                />
                <CommunicationView
                    v-else-if="activeFeature === 'communication'"
                />
                <ToolsView
                    v-else-if="activeFeature === 'tools'"
                />
                <TimelineView
                    v-else-if="activeFeature === 'timeline'"
                    @close="backToDesktop"
                />
                <VerificationView
                    v-else-if="activeFeature === 'verification'"
                />
                <ChangePasswordView
                    v-else-if="activeFeature === 'password'"
                    @close="backToDesktop"
                />
                <ForgotPasswordView
                    v-else-if="activeFeature === 'forgot'"
                />
                <DesktopView v-else @open="openFolder" @open-page="openFeature" />
            </main>

            <!-- 线索栏与拖拽浮层挂在外层，任何视图下都可用 -->
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
