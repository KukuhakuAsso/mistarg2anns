<script setup>
// 主界面：7 + 1 个文件夹入口，随进度解锁。
import FolderItem from "@/components/FolderItem.vue";
import { useGameState } from "@/composables/useGameState";
import { MAIN_FOLDERS } from "@/config/folders";

const emit = defineEmits(["open"]);

const { folderStates, unlockedCount, completedCount } = useGameState();

function hintOf(folder) {
    if (folder.unlocked) return "";
    if (folder.hidden) {
        return `完成全部 ${MAIN_FOLDERS.length} 份档案后解锁`;
    }

    const index = MAIN_FOLDERS.findIndex((item) => item.id === folder.id);
    const previous = MAIN_FOLDERS[index - 1];
    return previous ? `完成「${previous.name}」后解锁` : "可直接进入";
}
</script>

<template>
    <section class="desktop">
        <header class="desktop__head">
            <h1 class="desktop__title">档案柜</h1>
            <p class="desktop__desc">
                共 {{ folderStates.length }} 份档案，按进度依次解锁。
                已解锁 {{ unlockedCount }} 份，已完成 {{ completedCount }} 份。
            </p>
        </header>

        <ul class="desktop__grid">
            <li v-for="folder in folderStates" :key="folder.id">
                <FolderItem
                    :folder="folder"
                    :hint="hintOf(folder)"
                    @open="emit('open', $event)"
                />
            </li>
        </ul>
    </section>
</template>

<style scoped>
.desktop {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.desktop__title {
    font-size: 20px;
}

.desktop__desc {
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-dim);
}

.desktop__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
}
</style>
