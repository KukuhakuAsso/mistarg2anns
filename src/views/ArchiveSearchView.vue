<script setup>
import { computed, ref } from "vue";
import { searchArchiveById } from "@/config/archiveDatabase";

const emit = defineEmits(["close"]);

const query = ref("");
const lastQuery = ref("");

const results = computed(() => {
  if (!lastQuery.value.trim()) {
    return [];
  }
  return searchArchiveById(lastQuery.value);
});

function handleSearch() {
  lastQuery.value = query.value;
}

function handleSubmit(event) {
  event.preventDefault();
  handleSearch();
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">档案检索</p>
        <h1>数据库搜索</h1>
      </div>
      <!-- <button class="ghost-button" type="button" @click="emit('close')">
        返回桌面
      </button> -->
    </header>

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <form class="search-form" @submit="handleSubmit">
          <label class="search-field">
            <span>档案 ID</span>
            <div class="search-input-wrap">
              <input
                v-model="query"
                type="text"
                placeholder="例如：ARC-001 或 02"
                autocomplete="off"
              />
              <button class="primary-button" type="submit">搜索</button>
            </div>
          </label>
        </form>

        <div v-if="results.length" class="results-block">
          <p class="results-header">检索结果（{{ results.length }}）</p>
          <ul class="result-list">
            <li v-for="item in results" :key="item.id" class="result-item">
              <div class="result-item__head">
                <strong>{{ item.id }}</strong>
                <span class="tag">{{ item.category }}</span>
              </div>
              <h2>{{ item.name }}</h2>
              <p>{{ item.summary }}</p>
              <div class="meta-row">
                <span>归档人：{{ item.owner }}</span>
                <span>状态：{{ item.status }}</span>
                <span>更新时间：{{ item.updatedAt }}</span>
              </div>
            </li>
          </ul>
        </div>

        <div v-else-if="lastQuery" class="empty-state">
          <p>未找到与“{{ lastQuery }}”匹配的档案记录。</p>
          <small>尝试输入完整档案 ID，例如 ARC-001。</small>
        </div>

        <div v-else class="empty-state empty-state--hint">
          <p>输入档案 ID 后即可查询对应文件。</p>
          <small>当前数据库中可检索的示例：ARC-001 ～ ARC-008</small>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.page-shell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.page-shell__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-shell__title h1 {
  margin: 0;
  font-size: 28px;
}

.page-shell__eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.page-shell__body {
  display: flex;
  justify-content: center;
}

.panel-card {
  width: min(980px, 100%);
  padding: 20px 18px 18px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.panel-card--wide {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.search-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-input-wrap input {
  flex: 1;
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
  font-size: 15px;
}

.primary-button,
.ghost-button {
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 10px 16px;
  cursor: pointer;
}

.primary-button {
  border-color: rgba(111, 168, 255, 0.7);
  background: linear-gradient(135deg, rgba(80, 127, 255, 0.2), rgba(129, 92, 246, 0.18));
}

.results-header {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.result-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.result-item__head strong {
  font-size: 16px;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(113, 187, 255, 0.12);
  color: #a7d9ff;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.result-item h2 {
  margin: 0;
  font-size: 22px;
}

.result-item p {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.7;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--text-dim);
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--text-dim);
}

.empty-state p,
.empty-state small {
  margin: 0;
}

.empty-state--hint {
  padding: 22px 18px;
}
</style>
