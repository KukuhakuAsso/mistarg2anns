<script setup>
const props = defineProps({
    open: { type: Boolean, default: false },
    title: { type: String, default: "用户" },
    subtitle: { type: String, default: "个人终端" },
    items: {
        type: Array,
        default: () => [],
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

const emit = defineEmits(["close", "item-click"]);
</script>

<template>
    <div v-if="open" class="panel-overlay" @click.self="emit('close')">
        <aside
            class="user-panel"
            role="dialog"
            :aria-label="title"
            :style="{ maxWidth: props.maxWidth }"
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
    display: grid;
    place-items: center;
    background: rgba(8, 13, 20, 0.28);
    backdrop-filter: blur(2px);
}

.user-panel {
    position: relative;
    width: min(var(--panel-width, 760px), calc(100vw - 40px));
    max-width: calc(100vw - 40px);
    padding: 18px 20px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 12px 28px color-mix(in srgb, var(--text) 12%, transparent);
}

.user-panel__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 14px;
}

.user-panel__eyebrow {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
}

.user-panel__title {
    margin: 4px 0 0;
    font-size: 20px;
}

.user-panel__content {
    min-height: 80px;
}

.user-panel__list {
    display: flex;
    flex-direction: row;
    gap: 12px;
    flex-wrap: wrap;
}

.user-panel__item {
    display: flex;
    flex: 1 1 140px;
    flex-direction: column;
    justify-content: center;
    min-height: 88px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
        transform 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease;
}

.user-panel__item:hover {
    transform: translateY(-1px);
    border-color: var(--border-strong);
    box-shadow: 0 8px 18px color-mix(in srgb, var(--text) 8%, transparent);
}

.user-panel__item-name {
    font-size: 15px;
    font-weight: 600;
}

.user-panel__item-detail {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-dim);
}

.user-panel__empty {
    margin: 0;
    padding: 14px 4px 0;
    color: var(--text-dim);
}
</style>
