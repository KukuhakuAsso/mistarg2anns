<script setup>
// 线索栏：上半部分是自由排布的板面，下半部分是待用线索。
// 拖拽逻辑见 composables/useClueDrag.js。
//
// 宽度可由用户拖动左侧把手调整（双击把手恢复默认）：
// 默认值来自 :root 的 --panel-w（clamp(320px, 32vw, 440px)），
// 拖过之后用内联的 --panel-w 覆盖，并记在 localStorage 里。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import ClueCard from "@/components/ClueCard.vue";
import PuzzleCover from "@/components/puzzle/PuzzleCover.vue";
import { useClueDrag } from "@/composables/useClueDrag";
import { useClueBoardSync } from "@/composables/useClueBoardSync";
import { useGameState } from "@/composables/useGameState";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { CARD_GAP, CARD_H } from "@/config/board";
import {
    CLUE_PANEL_MAX_W,
    CLUE_PANEL_MIN_W,
    clampCluePanelWidth,
} from "@/utils/panelWidth";

const {
    state,
    boardClues,
    poolClues,
    removeClueFromBoard,
    clearBoard,
    arrangeBoard,
    addClueToBoard,
    uncollectCard,
    pendingClueBoardChanges,
} = useGameState();
const { boardEl, drag, startDrag } = useClueDrag();
const { flush: flushClueBoard, cooldownRemaining } = useClueBoardSync();
const {
    message: syncMessage,
    tone: syncTone,
    set: setSyncMessage,
    clear: clearSyncMessage,
} = useStatusMessage();

// ---------- 主动上传 ----------
// 服务端限流是「同账号 5 分钟一次」，改动要等冷却结束才会自动上传；
// 这里给一个立刻尝试的入口（force 跳过本地冷却，服务端仍可能 429）。
const uploading = ref(false);

const pendingCount = computed(() => pendingClueBoardChanges().length);

// 冷却剩余时间的可读文案（0 → 空串）
function cooldownText() {
    const ms = cooldownRemaining();
    if (ms <= 0) return "";
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

const uploadTitle = computed(() => {
    if (uploading.value) return "正在上传…";
    if (!pendingCount.value) return "没有待上传的改动";
    const cd = cooldownText();
    return cd
        ? `立即上传（服务端限流：约 ${cd} 后自动重试）`
        : "立即上传线索栏改动";
});

async function uploadNow() {
    if (uploading.value) return;
    if (!pendingCount.value) {
        setSyncMessage("info", "没有待上传的改动。");
        return;
    }

    uploading.value = true;
    setSyncMessage("pending", "正在上传线索栏…");
    try {
        const result = await flushClueBoard({ force: true });
        if (result?.ok) {
            const n = Number(result.uploaded ?? 0);
            setSyncMessage(
                "success",
                n > 0 ? `已上传 ${n} 项改动。` : "已是最新，无需上传。",
            );
            return;
        }
        if (result?.stale) {
            // 期间换了账号：静默，别给新会话弹上一个账号的结果
            clearSyncMessage();
            return;
        }
        if (result?.throttled) {
            const ms = Number(result.retryAfterMs ?? 0);
            const wait = ms > 0 ? `${Math.ceil(ms / 1000)} 秒` : "稍后";
            setSyncMessage("info", `服务端限流：约 ${wait} 后会自动重试。`);
            return;
        }
        if (result?.retryAfter) {
            setSyncMessage(
                "error",
                `上传过于频繁，请 ${result.retryAfter} 秒后再试（已按服务端要求顺延）。`,
            );
            return;
        }
        if (result?.rejected) {
            setSyncMessage(
                "error",
                "这批改动被服务端拒绝，请挪动一下卡片再试。",
            );
            return;
        }
        setSyncMessage("error", "上传失败，请稍后重试。");
    } finally {
        uploading.value = false;
    }
}

// ---------- 宽度调整 ----------

const WIDTH_STORAGE_KEY = "mistarg2anns:clue-board-width";
// 键盘每次调整的步长
const WIDTH_STEP = 24;

// 面板根元素：拖动时用它拿当前实际宽度（可能是 CSS 里 clamp() 算出来的）
const panelEl = ref(null);
// null = 沿用 CSS 默认宽度；数字 = 用户拖过的像素宽
const panelWidth = ref(readStoredWidth());
const resizing = ref(false);
let resizeStart = null;

function readStoredWidth() {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return null;
        // 存的是上次的宽度，但视口可能已经变了
        return clampCluePanelWidth(parsed, window.innerWidth);
    } catch {
        return null;
    }
}

function persistWidth(value) {
    if (typeof window === "undefined") return;
    try {
        if (value == null) {
            window.localStorage.removeItem(WIDTH_STORAGE_KEY);
        } else {
            window.localStorage.setItem(WIDTH_STORAGE_KEY, String(value));
        }
    } catch {
        // 隐私模式写不进去：本次会话仍然生效，只是不记忆
    }
}

function measuredWidth() {
    if (panelWidth.value != null) return panelWidth.value;
    const rect = panelEl.value?.getBoundingClientRect();
    if (rect && rect.width > 0) return Math.round(rect.width);
    return CLUE_PANEL_MIN_W;
}

// 只有拖过才写内联变量，否则保持 CSS 的 clamp(320px, 32vw, 440px) 自适应
const panelStyle = computed(() =>
    panelWidth.value == null
        ? undefined
        : { "--panel-w": `${panelWidth.value}px` },
);

function startResize(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    // 别让它冒泡到板面/卡片的拖拽逻辑上
    event.stopPropagation();

    resizeStart = { x: event.clientX, width: measuredWidth() };
    resizing.value = true;
    document.body.classList.add("is-resizing-panel");
    document.addEventListener("pointermove", onResizing);
    document.addEventListener("pointerup", stopResize, { once: true });
    document.addEventListener("pointercancel", stopResize, { once: true });
}

function onResizing(event) {
    if (!resizeStart) return;
    // 线索栏在右侧：指针往左移 → 变宽
    const next = resizeStart.width - (event.clientX - resizeStart.x);
    panelWidth.value = clampCluePanelWidth(next, window.innerWidth);
}

function stopResize() {
    if (!resizeStart) return;
    resizeStart = null;
    resizing.value = false;
    document.body.classList.remove("is-resizing-panel");
    document.removeEventListener("pointermove", onResizing);
    document.removeEventListener("pointercancel", stopResize);
    persistWidth(panelWidth.value);
}

// 键盘也能调（把手可获得焦点）：左方向键 = 往左扩 = 变宽
function nudgeWidth(event) {
    const step =
        event.key === "ArrowLeft"
            ? WIDTH_STEP
            : event.key === "ArrowRight"
              ? -WIDTH_STEP
              : 0;
    if (!step) return;
    event.preventDefault();
    panelWidth.value = clampCluePanelWidth(
        measuredWidth() + step,
        window.innerWidth,
    );
    persistWidth(panelWidth.value);
}

// 双击把手恢复 CSS 默认宽度（并清掉记忆）
function resetWidth() {
    panelWidth.value = null;
    persistWidth(null);
}

// 窗口变窄时把已经记住的宽度收进合法区间，避免线索栏把内容挤没
function onViewportResize() {
    if (panelWidth.value == null) return;
    const next = clampCluePanelWidth(panelWidth.value, window.innerWidth);
    if (next !== panelWidth.value) {
        panelWidth.value = next;
        persistWidth(next);
    }
}

onMounted(() => {
    window.addEventListener("resize", onViewportResize);
});

onBeforeUnmount(() => {
    window.removeEventListener("resize", onViewportResize);
    // 拖拽过程中组件被卸载：把挂在 document 上的监听器收干净
    document.removeEventListener("pointermove", onResizing);
    document.removeEventListener("pointercancel", stopResize);
    document.body.classList.remove("is-resizing-panel");
});

// 卡片被拖到下方时垫高画布，保证仍可滚动查看
const canvasStyle = computed(() => {
    const bottom = boardClues.value.reduce(
        (max, clue) => Math.max(max, clue.y + CARD_H),
        0,
    );
    return bottom > 0 ? { minHeight: `${bottom + CARD_GAP}px` } : {};
});

function currentBoardWidth() {
    return boardEl.value ? boardEl.value.getBoundingClientRect().width : 0;
}

function onPoolPointerDown(event, clue) {
    if (event.target.closest("button")) return;
    // 带上元数据：重新落板时会刷新这份快照（也兜住历史数据里 label 丢失的情况）
    startDrag(event, clue.id, "pool", {
        id: clue.id,
        title: clue.title,
        subtitle: clue.folderName,
        cover: clue.cover,
    });
}
</script>

<template>
    <!-- 线索栏需要登录：未登录时即使本地记着「展开」也不显示 -->
    <aside
        v-show="state.user.currentUser && state.ui.cluePanelOpen"
        ref="panelEl"
        class="clue-board"
        :class="{ 'is-resizing': resizing }"
        :style="panelStyle"
    >
        <!-- 左侧靠边把手：拖动或按左右方向键调整宽度，双击恢复默认 -->
        <span
            class="clue-board__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动或按左右方向键调整线索栏宽度，双击恢复默认"
            :aria-valuenow="panelWidth ?? undefined"
            :aria-valuemin="CLUE_PANEL_MIN_W"
            :aria-valuemax="CLUE_PANEL_MAX_W"
            tabindex="0"
            @pointerdown="startResize"
            @keydown="nudgeWidth"
            @dblclick="resetWidth"
        />

        <header class="clue-board__head">
            <h2 class="clue-board__title">线索栏</h2>
            <span class="clue-board__count">
                {{ boardClues.length }} 项
            </span>
            <div class="clue-board__tools">
                <button
                    class="icon-btn"
                    type="button"
                    :title="uploadTitle"
                    :disabled="uploading || pendingCount === 0"
                    @click="uploadNow"
                >
                    <AppIcon name="upload" />
                </button>
                <button
                    class="icon-btn"
                    type="button"
                    title="自动排列"
                    :disabled="boardClues.length === 0"
                    @click="arrangeBoard(currentBoardWidth())"
                >
                    <AppIcon name="arrange" />
                </button>
                <button
                    class="icon-btn"
                    type="button"
                    title="清空板面"
                    :disabled="boardClues.length === 0"
                    @click="clearBoard()"
                >
                    <AppIcon name="trash" />
                </button>
            </div>
        </header>

        <!-- 上传结果 / 冷却提示：只在有话说时占位，避免面板高度跳动 -->
        <p
            v-if="syncMessage"
            class="clue-board__sync"
            :class="`is-${syncTone}`"
        >
            {{ syncMessage }}
        </p>

        <div class="board" :class="{ 'board--over': drag.active && drag.overBoard }">
            <div ref="boardEl" class="board__canvas" :style="canvasStyle">
                <ClueCard
                    v-for="clue in boardClues"
                    :key="clue.id"
                    :clue="clue"
                    :dragging="drag.active && drag.clueId === clue.id"
                    @remove="removeClueFromBoard(clue.id)"
                />
                <p v-if="boardClues.length === 0" class="board__empty">
                    把题目文件或线索拖进来，自由排布
                </p>
            </div>
        </div>

        <section class="pool">
            <h3 class="pool__title">待用线索</h3>
            <p v-if="poolClues.length === 0" class="pool__empty">
                从档案里把题目拖到板面；把板面卡片拖出板面，会回到这里
            </p>
            <ul v-else class="pool__list">
                <li
                    v-for="clue in poolClues"
                    :key="clue.id"
                    class="pool__item"
                    :class="{
                        'is-dragging': drag.active && drag.clueId === clue.id,
                    }"
                    @pointerdown="onPoolPointerDown($event, clue)"
                >
                    <span class="pool__thumb" aria-hidden="true">
                        <PuzzleCover :cover="clue.cover" :alt="clue.title" />
                    </span>
                    <span class="pool__meta">
                        <span class="pool__label">{{ clue.title }}</span>
                        <span class="pool__source">{{ clue.folderName }}</span>
                    </span>
                    <button
                        class="icon-btn icon-btn--sm"
                        type="button"
                        title="加入板面"
                        @click="addClueToBoard(clue.id, currentBoardWidth())"
                    >
                        <AppIcon name="plus" :size="14" />
                    </button>
                    <button
                        class="icon-btn icon-btn--sm"
                        type="button"
                        title="从待用区移除"
                        @click="uncollectCard(clue.id)"
                    >
                        <AppIcon name="trash" :size="14" />
                    </button>
                </li>
            </ul>
        </section>
    </aside>
</template>

<style scoped>
.clue-board {
    position: relative;
    display: flex;
    flex-direction: column;
    width: var(--panel-w);
    flex: none;
    border-left: 1px solid var(--border);
    background: var(--surface);
}

/* 宽度把手：骑在左边框内侧，命中区 6px，视觉上只在悬停/聚焦时露出来 */
.clue-board__resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 2;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
}

.clue-board__resizer::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 2px;
    width: 1px;
    height: 34px;
    transform: translateY(-50%);
    border-radius: 1px;
    background: var(--border-strong);
    opacity: 0;
    transition: opacity 0.15s ease;
}

.clue-board__resizer:hover::after,
.clue-board__resizer:focus-visible::after,
.clue-board.is-resizing .clue-board__resizer::after {
    width: 2px;
    background: var(--accent);
    opacity: 1;
}

.clue-board__resizer:focus-visible {
    outline: none;
}

.clue-board__head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
}

/* 上传结果 / 冷却提示：一行小字，颜色沿用全局语义色变量 */
.clue-board__sync {
    margin: 0;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-dim);
    overflow-wrap: anywhere;
}

.clue-board__sync.is-success {
    color: var(--accent);
}

.clue-board__sync.is-error {
    color: #d9534f;
}

.clue-board__title {
    font-size: 13px;
    letter-spacing: 0.04em;
}

.clue-board__count {
    flex: 1;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-dim);
}

.clue-board__tools {
    display: flex;
    gap: 4px;
}

.board {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background-image: radial-gradient(var(--border) 1px, transparent 1px);
    background-size: 16px 16px;
}

.board--over {
    background-color: var(--accent-soft);
}

.board__canvas {
    position: relative;
    height: 100%;
}

.board__empty {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    transform: translateY(-50%);
    padding: 0 20px;
    font-size: 12px;
    color: var(--text-dim);
    text-align: center;
}

.pool {
    flex: none;
    max-height: 38%;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    padding: 10px 12px 12px;
}

.pool__title {
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-dim);
}

.pool__empty {
    font-size: 12px;
    color: var(--text-dim);
}

.pool__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.pool__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-alt);
    cursor: grab;
    touch-action: none;
    user-select: none;
}

.pool__item.is-dragging {
    opacity: 0.35;
}

.pool__thumb {
    display: block;
    width: 48px;
    height: 36px;
    overflow: hidden;
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
}

.pool__thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.pool__meta {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.pool__label {
    min-width: 0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.pool__source {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text-dim);
}

@media (max-width: 860px) {
    .clue-board {
        position: absolute;
        inset: 0;
        z-index: 10;
        width: 100%;
        border-left: none;
    }

    /* 窄屏是整屏浮层，宽度由视口决定，把手没有意义 */
    .clue-board__resizer {
        display: none;
    }
}
</style>
