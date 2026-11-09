<script setup>
// 队伍页的提交记录面板：先选一道题，再看本队在该题上的提交历史。
//
// 后端没有「队伍级提交汇总」接口，玩家侧只有 GET /api/puzzle/:key/submissions（按题查），
// 所以这里的定位方式是「选题 → 看该题」，不做跨题聚合（N 题就是 N 次请求）。
// 题目清单来自 usePuzzleMap 单例（只含已解锁题，带 solved 标记与目录分组）。
import { computed, onMounted, ref, watch } from "vue";
import { usePuzzleMap } from "@/composables/usePuzzleMap";
import SubmissionHistory from "@/components/puzzle/SubmissionHistory.vue";

const { folders, loaded, loading, error, load, refresh: refreshMap } = usePuzzleMap();

const selectedKey = ref("");
const historyRef = ref(null);

// 按目录分组，保留目录顺序与题目顺序（沿用 map 的下发顺序，不自己重排）
const groups = computed(() =>
  folders.value
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      entries: folder.entries.filter((entry) => entry.kind === "puzzle"),
    }))
    .filter((group) => group.entries.length > 0),
);

const flatEntries = computed(() => groups.value.flatMap((g) => g.entries));

const selectedEntry = computed(
  () => flatEntries.value.find((entry) => entry.id === selectedKey.value) ?? null,
);

// 默认选中第一道未解出的题；全解完了就选第一道
function pickDefault() {
  if (!flatEntries.value.length) {
    selectedKey.value = "";
    return;
  }
  const firstUnsolved = flatEntries.value.find((entry) => !entry.solved);
  selectedKey.value = (firstUnsolved ?? flatEntries.value[0]).id;
}

onMounted(async () => {
  await load();
  if (!selectedKey.value) pickDefault();
});

// map 之后又刷新过（例如解出题目）：当前选中的题若消失了才重新挑
watch(flatEntries, (entries) => {
  if (!entries.length) {
    selectedKey.value = "";
    return;
  }
  if (!entries.some((entry) => entry.id === selectedKey.value)) pickDefault();
});

// 刷新：题目清单（可能新解锁 / 新首解）+ 当前题的记录一起重取
async function refresh() {
  await refreshMap();
  historyRef.value?.refresh();
}
</script>

<template>
  <div class="submission-panel">
    <p v-if="error" class="submission-panel__state">{{ error }}</p>
    <p v-else-if="loading && !flatEntries.length" class="submission-panel__state">
      正在加载题目…
    </p>
    <p v-else-if="!flatEntries.length" class="submission-panel__state">
      暂无可查看的题目（需已确认参赛且比赛开始）。
    </p>

    <template v-else>
      <div class="submission-panel__bar">
        <label class="submission-panel__label" for="submission-puzzle">
          题目
        </label>
        <select
          id="submission-puzzle"
          v-model="selectedKey"
          class="submission-panel__select"
        >
          <optgroup
            v-for="group in groups"
            :key="group.id"
            :label="group.name"
          >
            <option
              v-for="entry in group.entries"
              :key="entry.id"
              :value="entry.id"
            >
              {{ entry.title || entry.id }}{{ entry.solved ? " · 已解出" : "" }}
            </option>
          </optgroup>
        </select>
        <button class="submission-panel__refresh" type="button" @click="refresh">
          刷新
        </button>
      </div>

      <p v-if="selectedEntry" class="submission-panel__meta">
        <span class="submission-panel__key">{{ selectedEntry.id }}</span>
        <span v-if="selectedEntry.solved" class="submission-panel__solved">
          已解出
        </span>
        <span class="submission-panel__hint">
          含答错与已解出后的重复提交 · 队伍内可见
        </span>
      </p>

      <SubmissionHistory
        v-if="loaded && selectedKey"
        ref="historyRef"
        :puzzle-key="selectedKey"
      />
    </template>
  </div>
</template>

<style scoped>
.submission-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.submission-panel__state {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}

.submission-panel__bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.submission-panel__label {
  flex: none;
  font-size: 12px;
  color: var(--text-dim);
}

.submission-panel__select {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.submission-panel__refresh {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.submission-panel__refresh:hover {
  color: var(--text);
}

.submission-panel__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}

.submission-panel__key {
  font-family: var(--mono);
  color: var(--text);
}

.submission-panel__solved {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}

.submission-panel__hint {
  opacity: 0.75;
}
</style>
