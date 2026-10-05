<script setup>
import { computed } from "vue";
import { MILESTONE_ROWS } from "@/config/milestones";

const emit = defineEmits(["close"]);

const rows = computed(() => MILESTONE_ROWS);
const completedRows = computed(() => rows.value.filter((row) => row.issueCompletion === "100%").length);
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">档案管理</p>
        <h1>里程碑</h1>
      </div>
      <!-- <button class="ghost-button" type="button" @click="emit('close')">
        返回桌面
      </button> -->
    </header>

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <div class="panel-card__header">
          <p class="panel-card__label">主线档案进度</p>
          <strong>{{ completedRows }}/7 已完成</strong>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>文件夹</th>
                <th>解锁时间</th>
                <th>完成时间</th>
                <th>总耗时</th>
                <th>问题完成</th>
                <th>里程碑个数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td>
                  <div class="folder-name">
                    <span class="folder-dot"></span>
                    {{ row.folderName }}
                  </div>
                </td>
                <td>{{ row.unlockTime }}</td>
                <td>{{ row.completedTime }}</td>
                <td>{{ row.totalDuration }}</td>
                <td>
                  <span class="progress-pill">{{ row.issueCompletion }}</span>
                </td>
                <td>{{ row.milestoneCount }}</td>
              </tr>
            </tbody>
          </table>
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
  width: min(1180px, 100%);
  padding: 20px 18px 18px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.panel-card--wide {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-card__label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.panel-card__header strong {
  color: var(--text-strong);
  font-size: 14px;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;
}

th,
td {
  padding: 14px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  color: var(--text);
}

th {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

tbody tr:last-child td {
  border-bottom: none;
}

.folder-name {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.folder-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(99, 161, 255, 0.9), rgba(139, 92, 246, 0.9));
  box-shadow: 0 0 0 3px rgba(99, 161, 255, 0.18);
}

.progress-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(76, 201, 240, 0.14);
  color: #8fe3ff;
  font-weight: 700;
}

.ghost-button {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
}
</style>
