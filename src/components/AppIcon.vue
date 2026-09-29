<script setup>
// 统一图标集：全部为内联 SVG 线稿，不使用 emoji。
import { computed } from "vue";

const ICONS = {
    desktop: [
        "M3.5 3.5h7v7h-7z",
        "M13.5 3.5h7v7h-7z",
        "M3.5 13.5h7v7h-7z",
        "M13.5 13.5h7v7h-7z",
    ],
    folder: [
        "M3.5 7a2 2 0 0 1 2-2h3.2l2 2h6.8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z",
    ],
    board: ["M4 5.5h16v13H4z", "M15 5.5v13"],
    lock: ["M6.5 10.5h11v9h-11z", "M9.5 10.5V8a2.5 2.5 0 0 1 5 0v2.5"],
    doc: ["M6.5 3.5h7l4 4v13h-11z", "M13.5 3.5v4h4"],
    bookmark: ["M7 3.5h10v17l-5-4.2-5 4.2z"],
    check: ["M5 12.5l4.5 4.5L19 7"],
    close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
    reset: ["M20 12a8 8 0 1 1-2.4-5.7", "M20.5 3.5V9H15"],
    sun: [
        "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
        "M12 2.5v2.2",
        "M12 19.3v2.2",
        "M2.5 12h2.2",
        "M19.3 12h2.2",
        "M5.2 5.2l1.6 1.6",
        "M17.2 17.2l1.6 1.6",
        "M18.8 5.2l-1.6 1.6",
        "M6.8 17.2l-1.6 1.6",
    ],
    moon: ["M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"],
    monitor: ["M3.5 5.5h17v10h-17z", "M9 19.5h6", "M12 15.5v4"],
    arrange: [
        "M4 5h5v5H4z",
        "M4 14h5v5H4z",
        "M13.5 5.5h6.5",
        "M13.5 12h6.5",
        "M13.5 18.5h6.5",
    ],
    trash: ["M5.5 7.5h13", "M9.5 7.5V5.5h5v2", "M7.5 7.5l1 12h7l1-12"],
    back: ["M19 12H5", "M11 6l-6 6 6 6"],
    plus: ["M12 6v12", "M6 12h12"],
};

const props = defineProps({
    name: { type: String, required: true },
    size: { type: [Number, String], default: 18 },
});

const paths = computed(() => ICONS[props.name] ?? []);
</script>

<template>
    <svg
        class="app-icon"
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <path v-for="(d, index) in paths" :key="index" :d="d" />
    </svg>
</template>

<style scoped>
.app-icon {
    display: block;
    flex: none;
}
</style>
