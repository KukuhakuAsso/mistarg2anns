<script setup>
// 拖拽浮层：跟随指针显示被拖动的线索，避免改动手柄自身布局。
import { computed } from "vue";
import { useClueDrag } from "@/composables/useClueDrag";
import { CLUE_BY_ID } from "@/config/folders";
import { CARD_H, CARD_W } from "@/config/board";

const { drag } = useClueDrag();

const clue = computed(() =>
    drag.clueId ? (CLUE_BY_ID.get(drag.clueId) ?? null) : null,
);

const style = computed(() => ({
    width: `${drag.w || CARD_W}px`,
    height: `${drag.h || CARD_H}px`,
    transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`,
}));
</script>

<template>
    <Teleport to="body">
        <div v-if="drag.active && clue" class="drag-ghost" :style="style">
            <div class="drag-ghost__text">
                <span class="drag-ghost__title">{{ clue.title }}</span>
            </div>
            <div v-if="clue.thumbnail" class="drag-ghost__thumb">
                <img :src="clue.thumbnail" :alt="clue.title" />
            </div>
            <div class="drag-ghost__text">
                <span class="drag-ghost__foot">{{ clue.folderName }}</span>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--surface);
    pointer-events: none;
    box-shadow: 0 12px 28px color-mix(in srgb, var(--text) 16%, transparent);
}

.drag-ghost__thumb {
    overflow: hidden;
    width: 100%;
    aspect-ratio: 4 / 3;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-alt);
}

.drag-ghost__thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.drag-ghost__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.drag-ghost__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.drag-ghost__foot {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text-dim);
}
</style>
