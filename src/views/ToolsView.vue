<script setup>
const emit = defineEmits(["close"]);

const websites = [
  {
    name: "搜索引擎",
    url: "https://www.google.com",
    description: "用于网络检索、资料收集与关键词扩展。",
  },
  {
    name: "维基百科",
    url: "https://www.wikipedia.org",
    description: "快速确认事件、机构、术语与历史背景。",
  },
  {
    name: "地图工具",
    url: "https://www.google.com/maps",
    description: "核对地点、坐标和时区变动的关联信息。",
  },
  {
    name: "代码调试",
    url: "https://developer.mozilla.org/zh-CN/",
    description: "用于核验交互逻辑、技术术语与前端实现。",
  },
];
</script>

<template>
  <section class="tools-app">
    <header class="tools-app__header">
      <div class="tools-app__title">
        <p class="eyebrow">工具</p>
        <h1>工具箱</h1>
      </div>
      <!-- <button class="ghost-button" type="button" @click="emit('close')">返回桌面</button> -->
    </header>

    <div class="tools-layout">
      <section class="panel-card panel-card--full">

        <ul class="tool-list">
          <li v-for="tool in websites" :key="tool.name" class="tool-item">
            <div class="tool-item__meta">
              <span class="tool-item__dot"></span>
              <strong>{{ tool.name }}</strong>
            </div>
            <p>{{ tool.description }}</p>
            <a :href="tool.url" target="_blank" rel="noreferrer">打开链接</a>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.tools-app {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.tools-app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.tools-app__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tools-app__title h1 {
  margin: 0;
  font-size: 28px;
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.tools-layout {
  min-height: 0;
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.panel-card--full {
  min-height: 0;
}

.panel-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-card__head h2 {
  margin: 0;
  font-size: 20px;
}

.panel-card__head span {
  color: var(--text-dim);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tool-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.tool-item__meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-item__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(89, 139, 255, 0.9), rgba(134, 235, 217, 0.9));
}

.tool-item strong {
  font-size: 15px;
}

.tool-item p {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.7;
}

.tool-item a {
  color: #9ac7ff;
  text-decoration: none;
  font-weight: 600;
}

.ghost-button {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
}

@media (max-width: 900px) {
  .timeline {
    min-height: 0;
  }
}
</style>
