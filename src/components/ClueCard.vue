<script setup>
// 线索栏板面上的卡片：可拖动改位置，拖出板面即退回待用区。
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useClueDrag } from "@/composables/useClueDrag";

const props = defineProps({
    clue: { type: Object, required: true },
    dragging: { type: Boolean, default: false },
});

const emit = defineEmits(["remove"]);

const { startDrag } = useClueDrag();

const style = computed(() => ({
    transform: `translate(${props.clue.x}px, ${props.clue.y}px)`,
}));
</script>

<template>
    <article
        class="clue-card"
        :class="{ 'is-dragging': dragging }"
        :style="style"
        @pointerdown="startDrag($event, clue.id, 'board')"
    >
        <header class="clue-card__head">
            <span class="clue-card__title">{{ clue.title }}</span>
            <button
                class="icon-btn icon-btn--sm"
                type="button"
                title="移回待用区"
                @pointerdown.stop
                @click="emit('remove')"
            >
                <AppIcon name="close" :size="14" />
            </button>
        </header>

        <p class="clue-card__body">{{ clue.body }}</p>

        <footer class="clue-card__foot">{{ clue.folderName }}</footer>
    </article>
</template>

<style scoped>
.clue-card {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: var(--card-w);
    height: var(--card-h);
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    user-select: none;
}

.clue-card.is-dragging {
    opacity: 0.35;
}

.clue-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
}

.clue-card__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.clue-card__body {
    flex: 1;
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-dim);
    white-space: pre-line;
    overflow: hidden;
}

.clue-card__foot {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text-dim);
}
</style>
