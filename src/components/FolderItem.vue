<script setup>
// 主界面上的单个文件夹入口：显示名称与状态角标（已完成 / 新文件）。
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps({
    folder: { type: Object, required: true },
});

const emit = defineEmits(["open"]);

const status = computed(() => {
    if (props.folder.completed) return "done";
    if (props.folder.visited) return "none";
    return "new";
});
</script>

<template>
    <div>
        <button
            class="folder-item"
            type="button"
            :class="{
                'folder-item--done': status === 'done',
                'folder-item--new': status === 'new',
            }"
            @click="emit('open', folder.id)"
        >
            <span class="folder-item__icon">
                <AppIcon name="folder" :size="22" />
            </span>

            <span class="folder-item__text">
                <span class="folder-item__name">{{ folder.name }}</span>
            </span>

            <span
                v-if="status !== 'none'"
                class="folder-item__status"
                :class="`folder-item__status--${status}`"
                :aria-label="status === 'done' ? '已完成' : '新文件'"
            >
                <AppIcon v-if="status === 'done'" name="check" :size="10" />
                <span v-else class="folder-item__status-dot" aria-hidden="true" />
            </span>
        </button>
    </div>

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
    height: 100%;
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
.folder-item__status {
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

.folder-item__status {
    position: absolute;
    right: 35px;
    bottom: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--surface) 85%, var(--text) 15%);
    background: color-mix(in srgb, var(--surface) 92%, var(--text) 8%);
    box-shadow: 0 2px 6px color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--text);
}

.folder-item__status--new {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
}

.folder-item__status--new .folder-item__status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent, #7aa7d6);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.folder-item__status--done {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
}

.folder-item--done {
    background: color-mix(in srgb, var(--accent-soft) 36%, var(--bg));
}
</style>
