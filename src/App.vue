<script setup>
// 伪桌面布局：顶部设置栏 + 主界面（档案） + 右侧线索栏。
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
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
import ChangePasswordView from "@/views/ChangePasswordView.vue";
import ForgotPasswordView from "@/views/ForgotPasswordView.vue";
import AppealView from "@/views/AppealView.vue";
import { FOLDER_BY_ID } from "@/config/folders";
import { FEATURE_ROUTES, router } from "@/router";
import { useGameState } from "@/composables/useGameState";

const {
    state,
    refreshUnreadSummary,
    refreshTeamTips,
    refreshAccountStatus,
    markAccountBanned,
    forceLogout,
} = useGameState();
// 当前路由对象（hash 路由维护的全局响应式状态），下面的派生判断都基于它。
const currentRoute = computed(() => router.currentRoute);

// 未登录也能访问的路由：桌面、登录注册、找回密码。
const PUBLIC_ROUTES = new Set(["desktop", "register", "forgot"]);
// 封禁后仍可访问的路由：在公开路由之外再加申诉页（解封前唯一能用的接口是 /me/*）。
const BAN_SAFE_ROUTES = new Set([...PUBLIC_ROUTES, "appeal"]);

// 访问守卫：未登录时只放行公开路由，其他路由一律送回登录页；immediate 让首屏也走一次判断。
// 已登录但账号被封禁（E_BANNED）时只拦功能页 —— 除 /me/* 三条接口外全部 403，
// 但桌面、登录/注册、找回密码、申诉页仍要能进（被封后还要能换账号登录 / 提交申诉）。
watch(
    () => [
        currentRoute.value.name,
        state.user.currentUser,
        state.accountStatus?.banned,
    ],
    ([routeName, currentUser, banned]) => {
        if (!currentUser) {
            if (!PUBLIC_ROUTES.has(routeName)) {
                router.goToRoute("/register");
            }
            return;
        }
        if (banned && !BAN_SAFE_ROUTES.has(routeName)) {
            router.goToRoute("/appeal");
        }
    },
    { immediate: true },
);

// 服务端数据轮询：未读角标、队伍 tips 余额与账号处罚状态
// （每 60 秒一次；页面隐藏时暂停，恢复可见时立即补刷）。
// tips 是队伍级的，同队任何人消费都会让余额变化；处罚状态可能被官方随时下发 / 解除，
// 或 until 到期自动解除，所以不能只在进入某页时读一次。
const UNREAD_POLL_MS = 60000;
let unreadTimer = null;

function refreshBadgeIfLoggedIn() {
    if (state.user.currentUser) {
        refreshUnreadSummary();
        refreshTeamTips();
        refreshAccountStatus();
    }
}

function handleVisibilityChange() {
    if (!document.hidden) {
        refreshBadgeIfLoggedIn();
    }
}

// 登录 / 切换账号后立即刷新一次角标、队伍 tips 与处罚状态。
watch(
    () => state.user.currentUser,
    (currentUser) => {
        if (currentUser) {
            refreshUnreadSummary();
            refreshTeamTips();
            refreshAccountStatus();
        }
    },
);

onMounted(() => {
    refreshBadgeIfLoggedIn();
    unreadTimer = window.setInterval(() => {
        if (!document.hidden) {
            refreshBadgeIfLoggedIn();
        }
    }, UNREAD_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // 任意接口返回 403 E_BANNED / 会话彻底失效时，按情况登出或收敛到申诉页
    window.addEventListener("mistarg:banned", handleBanned);
    window.addEventListener("mistarg:session-lost", handleSessionLost);
});

onBeforeUnmount(() => {
    if (unreadTimer !== null) {
        clearInterval(unreadTimer);
        unreadTimer = null;
    }
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("mistarg:banned", handleBanned);
    window.removeEventListener("mistarg:session-lost", handleSessionLost);
});

// 403 E_BANNED。
// - 会话中途被封（登录时快照里还没有封禁）：立刻退出登录 —— 封禁会递增 token_version，
//   旧令牌已全部失效，硬留在原页面只会得到一串 401/403，连 /me/* 申诉接口都调不动；
//   封禁账号可以正常登录，重新登录后由守卫直接送到申诉页。
// - 登录时就知道被封（sessionBanAcknowledged）：保持登录，收敛到申诉页即可。
function handleBanned(event) {
    if (!state.sessionBanAcknowledged) {
        const reason = event?.detail?.reason;
        forceLogout(
            `账号已被封禁${reason ? `：${reason}` : ""}，请重新登录后提交申诉。`,
        );
        return;
    }

    markAccountBanned();
    // 只从功能页收敛到申诉页；登录/注册、找回密码、桌面保持可用
    if (!BAN_SAFE_ROUTES.has(router.currentRoute.name)) {
        router.goToRoute("/appeal");
    }
    // 拿一次完整状态（封禁原因 / 到期 / 申诉额度）给申诉页展示
    refreshAccountStatus();
}

// 401 且刷新令牌也失效：会话已无法恢复，强制登出回到登录页，避免「看似登录、实际全 401」。
function handleSessionLost() {
    if (!state.user.currentUser) return;
    forceLogout("登录状态已失效，请重新登录。");
}

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
                <ChangePasswordView
                    v-else-if="activeFeature === 'password'"
                    @close="backToDesktop"
                />
                <AppealView
                    v-else-if="activeFeature === 'appeal'"
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
