<template>
  <div class="app">
    <header class="app-header">
      <h1>WebGAL × Vue 集成测试页</h1>
      <p class="sub">
        不魔改版集成方案：动态剧本流（方案 1）+ 宿主 UI 层交互（方案 4）
        <span class="badge">mock 后端 · dev/preview 生效</span>
      </p>
    </header>

    <main class="app-main">
      <GalPage ref="galRef" />
      <aside class="app-side">
        <PuzzlePanel @solved="onPuzzleSolved" />

        <section class="panel">
          <h2>剧本驱动流程（方案 1）</h2>
          <ol class="flow">
            <li>引擎标题页点击开始 → 请求 <code>entry.txt</code>（后端下发开场）</li>
            <li><code>choose</code> 选分支 → 选项值即后端剧本名</li>
            <li><code>puzzle.txt</code> 内 <code>getUserInput</code> 采集答案</li>
            <li>宿主捕获答案 → <code>POST /api-mist/submit-answer</code> 后端判定</li>
            <li>重载 iframe，后端按状态下发「答对→结局 / 答错→重试」分支</li>
          </ol>
        </section>

        <section class="panel">
          <h2>Mock 后端接口一览</h2>
          <table class="api-table">
            <thead>
              <tr><th>接口</th><th>作用</th></tr>
            </thead>
            <tbody>
              <tr><td><code>GET …/scene/entry.txt</code></td><td>开场剧本，按后端状态分支</td></tr>
              <tr><td><code>GET …/scene/puzzle.txt</code></td><td>谜题：getUserInput 采集答案</td></tr>
              <tr><td><code>GET …/scene/check.txt</code></td><td>判定过渡剧本（后端可校验 answer 参数）</td></tr>
              <tr><td><code>GET …/scene/ending.txt</code></td><td>结局剧本</td></tr>
              <tr><td><code>POST /api-mist/submit-answer</code></td><td>宿主提交答案，后端判定</td></tr>
              <tr><td><code>POST /api-mist/mark-puzzle-solved</code></td><td>宿主标记谜题已解</td></tr>
              <tr><td><code>GET /api-mist/status</code></td><td>查询后端状态</td></tr>
            </tbody>
          </table>
        </section>
      </aside>
    </main>

    <footer class="app-footer">
      <p>
        剧本 URL 必须以 <code>.txt</code> 结尾；每次交互即一次场景切换。
        静态托管（无后端）时，<code>game/scene/</code> 下的同名本地文件作为回退剧本。
      </p>
    </footer>
  </div>
</template>

<script setup>
import { ref } from "vue";
import GalPage from "./components/GalPage.vue";
import PuzzlePanel from "./components/PuzzlePanel.vue";

const galRef = ref();

// 宿主驱动（方案 4）：谜题在 Vue 侧完成后重新加载引擎，
// 后端按新状态下发「已解锁」分支
function onPuzzleSolved() {
  galRef.value?.reload();
}
</script>

<style scoped>
.app-header {
  padding: 8px 4px 20px;
}

.app-header h1 {
  font-size: 26px;
}

.app-header .sub {
  margin-top: 6px;
  color: var(--muted);
  font-size: 14px;
}

.badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid rgba(79, 140, 255, 0.5);
  border-radius: 999px;
  color: var(--accent);
  font-size: 12px;
  vertical-align: 1px;
}

.app-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}

@media (max-width: 980px) {
  .app-main {
    grid-template-columns: 1fr;
  }
}

.app-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.panel h2 {
  margin-bottom: 10px;
  font-size: 15px;
}

.flow {
  margin-left: 18px;
  color: var(--muted);
  font-size: 13px;
}

.flow li {
  margin: 6px 0;
}

code {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(79, 140, 255, 0.14);
  color: var(--accent);
  font-size: 12px;
}

.api-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.api-table th,
.api-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.api-table th {
  color: var(--muted);
  font-weight: 500;
}

.api-table td:first-child {
  white-space: nowrap;
}

.app-footer {
  margin-top: 20px;
  color: var(--muted);
  font-size: 12px;
}
</style>
