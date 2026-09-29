<script setup>
// 档案查看页：左侧为条目导航（题目 / 线索分开），右侧为正文。
import { computed, ref, watch } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useGameState } from "@/composables/useGameState";

const props = defineProps({
    folder: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const { state, setFolderCompleted, discoverClue, isClueDiscovered } =
    useGameState();

const puzzles = computed(() =>
    props.folder.entries.filter((entry) => entry.kind === "puzzle"),
);
const clues = computed(() =>
    props.folder.entries.filter((entry) => entry.kind === "clue"),
);
const completed = computed(() =>
    state.completedFolders.includes(props.folder.id),
);
const clueReadCount = computed(
    () => clues.value.filter((entry) => isClueDiscovered(entry.id)).length,
);

const selectedId = ref(props.folder.entries[0]?.id ?? null);

watch(
    () => props.folder.id,
    () => {
        selectedId.value = props.folder.entries[0]?.id ?? null;
    },
);

const selected = computed(
    () =>
        props.folder.entries.find((entry) => entry.id === selectedId.value) ??
        null,
);
</script>

<template>
    <section class="folder-view">
        <header class="folder-view__head">
            <button
                class="bar-btn"
                type="button"
                title="返回主界面"
                @click="emit('close')"
            >
                <AppIcon name="back" />
                <span>返回</span>
            </button>

            <div class="folder-view__title">
                <h1 class="folder-view__name">{{ folder.name }}</h1>
                <span class="folder-view__sub">{{ folder.subtitle }}</span>
            </div>

            <span v-if="completed" class="folder-view__done">
                <AppIcon name="check" :size="14" />
                本档案已完成
            </span>
            <button
                v-else
                class="bar-btn"
                type="button"
                title="完成后解锁下一份档案"
                @click="setFolderCompleted(folder.id)"
            >
                <AppIcon name="check" />
                <span>标记为已完成</span>
            </button>
        </header>

        <div class="folder-view__body">
            <nav class="entry-nav">
                <h2 class="entry-nav__group">题目</h2>
                <ul class="entry-nav__list">
                    <li v-for="entry in puzzles" :key="entry.id">
                        <button
                            class="entry-nav__item"
                            type="button"
                            :class="{ 'is-active': entry.id === selectedId }"
                            @click="selectedId = entry.id"
                        >
                            <AppIcon name="doc" :size="15" />
                            <span class="entry-nav__label">
                                {{ entry.title }}
                            </span>
                        </button>
                    </li>
                </ul>

                <h2 class="entry-nav__group">
                    线索
                    <span class="entry-nav__count">
                        {{ clueReadCount }}/{{ clues.length }}
                    </span>
                </h2>
                <ul class="entry-nav__list">
                    <li v-for="entry in clues" :key="entry.id">
                        <button
                            class="entry-nav__item"
                            type="button"
                            :class="{ 'is-active': entry.id === selectedId }"
                            @click="selectedId = entry.id"
                        >
                            <AppIcon name="bookmark" :size="15" />
                            <span class="entry-nav__label">
                                {{ entry.title }}
                            </span>
                            <AppIcon
                                v-if="isClueDiscovered(entry.id)"
                                name="check"
                                :size="13"
                            />
                        </button>
                    </li>
                </ul>
            </nav>

            <article v-if="selected" class="entry-detail">
                <header class="entry-detail__head">
                    <span class="entry-detail__kind">
                        {{ selected.kind === "puzzle" ? "题目" : "线索" }}
                    </span>
                    <h2 class="entry-detail__title">{{ selected.title }}</h2>
                </header>

                <p class="entry-detail__body">{{ selected.body }}</p>

                <footer v-if="selected.kind === 'clue'" class="entry-detail__foot">
                    <button
                        class="bar-btn"
                        type="button"
                        :disabled="isClueDiscovered(selected.id)"
                        @click="discoverClue(selected.id)"
                    >
                        <AppIcon name="bookmark" />
                        <span>
                            {{
                                isClueDiscovered(selected.id)
                                    ? "已加入线索栏"
                                    : "加入线索栏"
                            }}
                        </span>
                    </button>
                </footer>
            </article>
        </div>
    </section>
</template>

<style scoped>
.folder-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.folder-view__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
}

.folder-view__title {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
}

.folder-view__name {
    font-size: 18px;
}

.folder-view__sub {
    font-size: 13px;
    color: var(--text-dim);
}

.folder-view__done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--accent);
}

.folder-view__body {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 24px;
    align-items: start;
}

.entry-nav__group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
}

.entry-nav__group:not(:first-child) {
    margin-top: 18px;
}

.entry-nav__count {
    font-family: var(--mono);
}

.entry-nav__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.entry-nav__item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    font-size: 13px;
    color: var(--text);
    text-align: left;
    cursor: pointer;
}

.entry-nav__item:hover {
    border-color: var(--border);
}

.entry-nav__item.is-active {
    border-color: var(--border-strong);
    background: var(--accent-soft);
    color: var(--accent);
}

.entry-nav__label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.entry-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
}

.entry-detail__kind {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
}

.entry-detail__title {
    margin-top: 2px;
    font-size: 16px;
}

.entry-detail__body {
    min-height: 160px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
    white-space: pre-line;
}

.entry-detail__foot {
    display: flex;
    justify-content: flex-end;
    padding-top: 12px;
    border-top: 1px solid var(--border);
}

@media (max-width: 720px) {
    .folder-view__body {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
