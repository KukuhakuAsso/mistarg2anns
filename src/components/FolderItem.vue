<script setup>
// 主界面上的单个文件夹入口：解锁可进入，未解锁只显示解锁条件。
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps({
    folder: { type: Object, required: true },
    hint: { type: String, default: "" },
});

const emit = defineEmits(["open"]);

// 隐藏档案在锁定状态下不暴露名称
const label = computed(() =>
    props.folder.unlocked || !props.folder.hidden ? props.folder.name : "未归档",
);

const subLabel = computed(() =>
    props.folder.unlocked || !props.folder.hidden
        ? props.folder.subtitle
        : "解锁后可见",
);
</script>

<template>
    <button
        class="folder-item"
        type="button"
        :class="{
            'folder-item--locked': !folder.unlocked,
            'folder-item--done': folder.completed,
        }"
        :disabled="!folder.unlocked"
        @click="emit('open', folder.id)"
    >
        <span class="folder-item__head">
            <AppIcon :name="folder.unlocked ? 'folder' : 'lock'" :size="20" />
            <span class="folder-item__name">{{ label }}</span>
        </span>

        <span class="folder-item__sub">{{ subLabel }}</span>

        <span v-if="folder.unlocked" class="folder-item__meta">
            题目 {{ folder.puzzleCount }} · 线索 {{ folder.clueCount }}
        </span>
        <span v-else class="folder-item__meta folder-item__meta--hint">
            {{ hint }}
        </span>

        <span v-if="folder.completed" class="folder-item__badge">
            <AppIcon name="check" :size="13" />
            已完成
        </span>
    </button>
</template>

<style scoped>
.folder-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
    transition:
        border-color 0.15s,
        background 0.15s;
}

.folder-item:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--surface-alt);
}

.folder-item:disabled {
    cursor: default;
}

.folder-item__head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
}

.folder-item__name {
    font-size: 15px;
    font-weight: 600;
}

.folder-item__sub {
    font-size: 13px;
    color: var(--text-dim);
}

.folder-item__meta {
    margin-top: 6px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-dim);
}

.folder-item--locked {
    border-style: dashed;
    background: transparent;
}

.folder-item--locked .folder-item__head,
.folder-item--locked .folder-item__sub {
    color: var(--text-dim);
}

.folder-item--done {
    border-color: var(--accent);
    background: var(--accent-soft);
}

.folder-item__badge {
    position: absolute;
    top: 12px;
    right: 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--accent);
}
</style>
