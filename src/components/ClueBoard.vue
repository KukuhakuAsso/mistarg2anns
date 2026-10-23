<script setup>
// 线索栏：上半部分是自由排布的板面，下半部分是待用线索。
// 拖拽逻辑见 composables/useClueDrag.js。
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import ClueCard from "@/components/ClueCard.vue";
import PuzzleCover from "@/components/puzzle/PuzzleCover.vue";
import { useClueDrag } from "@/composables/useClueDrag";
import { useGameState } from "@/composables/useGameState";
import { CARD_GAP, CARD_H } from "@/config/board";

const {
    state,
    boardClues,
    poolClues,
    removeClueFromBoard,
    clearBoard,
    arrangeBoard,
    addClueToBoard,
    uncollectCard,
} = useGameState();
const { boardEl, drag, startDrag } = useClueDrag();

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
        class="clue-board"
    >
        <header class="clue-board__head">
            <h2 class="clue-board__title">线索栏</h2>
            <span class="clue-board__count">
                {{ boardClues.length }} 项
            </span>
            <div class="clue-board__tools">
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
    display: flex;
    flex-direction: column;
    width: var(--panel-w);
    flex: none;
    border-left: 1px solid var(--border);
    background: var(--surface);
}

.clue-board__head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
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
}
</style>
