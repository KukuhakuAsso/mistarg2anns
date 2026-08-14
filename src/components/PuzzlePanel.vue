<template>
  <section class="panel">
    <h2>宿主侧谜题（方案 4 演示）</h2>
    <p class="desc">
      引擎内 <code>getUserInput</code> 采集的答案由宿主捕获，调后端
      <code>POST /api-mist/submit-answer</code> 判定并更新状态；随后重载 iframe，
      后端按新状态下发「答对 / 答错」分支。也可用下方按钮直接模拟谜题已完成。
    </p>
    <p class="state">
      后端状态：<strong>{{ solved ? "谜题已解 ✅" : "谜题未解 ⬜" }}</strong>
      · 最近判定：<strong>{{ lastJudge }}</strong>
    </p>
    <p class="hint" :class="{ warn: hintWarn }">{{ hint }}</p>
    <div class="row">
      <button class="btn primary" :disabled="busy || solved" @click="markSolved">
        {{ busy ? "提交中…" : "模拟在宿主演算并标记已解" }}
      </button>
      <button class="btn" @click="refresh">刷新状态</button>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";

const emit = defineEmits(["solved"]);

const solved = ref(false);
const busy = ref(false);
const hint = ref("正在查询后端状态…");
const hintWarn = ref(false);
const lastJudge = ref("—");

async function refresh() {
  try {
    const res = await fetch("/api-mist/status");
    const data = await res.json();
    solved.value = !!data.puzzleSolved;
    lastJudge.value =
      data.answerCorrect === true ? "正确" : data.answerCorrect === false ? "错误" : "—";
    hint.value = data.mock
      ? "当前由 dev/preview 内置 mock 后端应答，正式环境将替换为真实后端。"
      : "已连接后端。";
    hintWarn.value = false;
  } catch {
    solved.value = false;
    lastJudge.value = "—";
    hint.value = "后端不可达：静态托管下 /api-mist 需真实后端，本地测试请用 dev/preview 启动。";
    hintWarn.value = true;
  }
}

async function markSolved() {
  busy.value = true;
  try {
    const res = await fetch("/api-mist/mark-puzzle-solved", { method: "POST" });
    const data = await res.json();
    solved.value = !!data.puzzleSolved;
    hint.value = "后端状态已更新，正在重新加载引擎并重新下发剧本…";
    hintWarn.value = false;
    emit("solved");
  } catch {
    hint.value = "标记失败：后端不可达。";
    hintWarn.value = true;
  } finally {
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped>
.desc {
  color: var(--muted);
  font-size: 13px;
}

.desc code,
.state code {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(79, 140, 255, 0.14);
  color: var(--accent);
  font-size: 12px;
}

.state {
  margin-top: 10px;
  font-size: 14px;
}

.hint {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
}

.hint.warn {
  color: #e0a050;
}

.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
</style>
