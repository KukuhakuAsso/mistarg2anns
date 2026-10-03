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
        class="folder-item folder-item--locked"
        type="button"
        :disabled="!folder.unlocked"
        @click="emit('open', folder.id)"
    >
        <span class="folder-item__icon">
            <AppIcon :name="folder.unlocked ? 'folder' : 'lock'" :size="22" />
        </span>

        <span class="folder-item__text">
            <span class="folder-item__name">{{ label }}</span>
            <span class="folder-item__sub">{{ subLabel }}</span>
        </span>

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
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    min-height: 72px;
    padding: 12px 14px;
    border: 0;
    border-radius: 10px;
    background: var(--bg);
    text-align: center;
    color: var(--text);
    cursor: pointer;
    overflow: hidden;
    isolation: isolate;
    transition:
        transform 0.18s ease,
        filter 0.18s ease;
}

.folder-item::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: var(--desktop-hover-glass-bg);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    opacity: 0;
    transition: opacity 0.18s ease;
}

.folder-item:hover::before {
    opacity: 1;
}

.folder-item:hover:not(:disabled) {
    filter: brightness(1.04);
}

.folder-item:disabled {
    cursor: default;
}

.folder-item__icon,
.folder-item__text,
.folder-item__meta,
.folder-item__badge {
    position: relative;
    z-index: 1;
}

.folder-item__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    color: var(--text);
    border-radius: 8px;
    background: rgba(128, 128, 128, 0.07);
    flex-shrink: 0;
}

.folder-item__text {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
}

.folder-item__name {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
}

.folder-item__sub {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-dim);
}

.folder-item__meta {
    font-size: 11px;
    line-height: 1.3;
    color: var(--text-dim);
    text-align: center;
}

.folder-item--locked {
    opacity: 0.9;
}

.folder-item--locked .folder-item__icon,
.folder-item--locked .folder-item__sub,
.folder-item--locked .folder-item__meta {
    color: var(--text-dim);
}

.folder-item--done {
    background: color-mix(in srgb, var(--accent-soft) 36%, var(--bg));
}

.folder-item__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(122, 167, 214, 0.12);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
}
</style>
