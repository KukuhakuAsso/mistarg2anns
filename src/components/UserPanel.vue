<script setup>
import { computed } from "vue";

const props = defineProps({
    open: { type: Boolean, default: false },
    title: { type: String, default: "用户" },
    subtitle: { type: String, default: "个人终端" },
    items: {
        type: Array,
        default: () => [],
    },
    position: {
        type: Object,
        default: () => ({ x: 0, y: 0 }),
    },
    maxWidth: {
        type: String,
        default: "760px",
    },
    showCloseButton: {
        type: Boolean,
        default: true,
    },
});

const panelStyle = computed(() => ({
    left: `${Math.max(12, props.position.x || 0)}px`,
    top: `${Math.max(12, props.position.y || 0)}px`,
}));

const emit = defineEmits(["close", "item-click"]);
</script>

<template>
    <div v-if="open" class="panel-overlay" @click.self="emit('close')">
        <aside
            class="user-panel"
            role="dialog"
            :aria-label="title"
            :style="[{ maxWidth: props.maxWidth }, panelStyle]"
        >
            <header v-if="title || subtitle || showCloseButton" class="user-panel__head">
                <div v-if="title || subtitle">
                    <p v-if="subtitle" class="user-panel__eyebrow">{{ subtitle }}</p>
                    <h2 v-if="title" class="user-panel__title">{{ title }}</h2>
                </div>

                <button
                    v-if="showCloseButton"
                    class="icon-btn"
                    type="button"
                    title="关闭"
                    @click="emit('close')"
                >
                    <span aria-hidden="true">×</span>
                </button>
            </header>

            <div v-if="$slots.default" class="user-panel__content">
                <slot />
            </div>

            <div v-else-if="items.length" class="user-panel__list">
                <button
                    v-for="item in items"
                    :key="item.id"
                    class="user-panel__item"
                    type="button"
                    @click="emit('item-click', item)"
                >
                    <span class="user-panel__item-name">{{ item.name }}</span>
                    <span class="user-panel__item-detail">{{ item.detail }}</span>
                </button>
            </div>
            <p v-else class="user-panel__empty">暂无内容</p>
        </aside>
    </div>
</template>

<style scoped>
.panel-overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: transparent;
}

.user-panel {
    position: fixed;
    z-index: 31;
    width: min(280px, calc(100vw - 24px));
    padding: 12px 12px 10px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.22);
}

.user-panel__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    padding: 2px 2px 0;
}

.user-panel__eyebrow {
    margin: 0;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
}

.user-panel__title {
    margin: 4px 0 0;
    font-size: 18px;
    line-height: 1.2;
}

.user-panel__content {
    min-height: 0;
}

.user-panel__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.user-panel__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.02);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
        transform 0.18s ease,
        border-color 0.18s ease,
        background 0.18s ease;
}

.user-panel__item:hover {
    transform: translateY(-1px);
    border-color: var(--border-strong);
    background: rgba(255, 255, 255, 0.04);
}

.user-panel__item-name {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
}

.user-panel__item-detail {
    font-size: 11px;
    line-height: 1.3;
    color: var(--text-dim);
    text-align: right;
}

.user-panel__empty {
    margin: 0;
    padding: 8px 4px;
    color: var(--text-dim);
}
</style>
