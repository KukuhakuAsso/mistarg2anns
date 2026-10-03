<script setup>
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps({
    app: { type: Object, required: true },
});

const emit = defineEmits(["open"]);
</script>

<template>
    <div class="desktop-app-item-wrapper">
    <button
        class="desktop-app-item"
        type="button"
        @click="emit('open', props.app.id)"
    >
        <span class="desktop-app-item__icon">
            <AppIcon :name="props.app.icon" :size="22" />
        </span>

        <span class="desktop-app-item__text">
            <span class="desktop-app-item__name">{{ props.app.name }}</span>
        </span>
    </button>
    </div>
</template>

<style scoped>
.desktop-app-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    gap: 12px;
    width: 100%;
    border: 0;
    border-radius: 10px;
    min-height: 72px;
    padding: 12px 14px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    isolation: isolate;
    transition:
        transform 0.18s ease,
        filter 0.18s ease;
}

.desktop-app-item::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 8px;
    background: var(--desktop-hover-glass-bg);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    opacity: 0;
    transition: opacity 0.18s ease;
}

.desktop-app-item:hover::before {
    opacity: 1;
}

.desktop-app-item:hover {
    filter: brightness(1.04);
}

.desktop-app-item__icon,
.desktop-app-item__text {
    position: relative;
    z-index: 1;
}

.desktop-app-item__icon {
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

.desktop-app-item__text {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
}

.desktop-app-item__name {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
}

.desktop-app-item__meta {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-dim);
}
</style>
