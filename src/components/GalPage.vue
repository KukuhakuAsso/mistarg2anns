<template>
  <section class="gal-page">
    <div class="gal-stage">
      <iframe v-if="frameSrc" ref="galFrame" :src="frameSrc" class="gal-frame" allow="autoplay; fullscreen" />
      <div v-else class="gal-loading">正在重新拉取剧本…</div>
      <!-- 答案判定结果页：提交后先展示判定结果，玩家确认后再回游戏 -->
      <div v-if="showResult" class="answer-mask">
        <div class="answer-card" :class="resultData.answerCorrect ? 'is-ok' : 'is-no'">
          <div class="answer-icon">{{ resultData.answerCorrect ? "✅" : "❌" }}</div>
          <h2 class="answer-title">
            {{ resultData.answerCorrect ? "答案正确！" : "答案错误" }}
          </h2>
          <p class="answer-sub">
            你输入的答案：<strong>{{ resultData.answer }}</strong>
          </p>
          <p class="answer-hint">
            {{ resultData.answerCorrect ? "后端验证通过。" : "再想想，返回后可以重新输入。" }}
          </p>
          <button class="answer-back" @click="backToGame">
            {{ resultData.answerCorrect ? "回到页面 →" : "返回重新输入" }}
          </button>
        </div>
      </div>
      <!-- 网络错误页：后端不可达时展示，可重试或返回游戏 -->
      <div v-if="showError" class="answer-mask">
        <div class="answer-card is-err">
          <div class="answer-icon">⚠️</div>
          <h2 class="answer-title">网络错误</h2>
          <p class="answer-sub">无法连接到后端服务</p>
          <p class="answer-hint">
            请确认后端已启动（{{ apiBase }} → API_SCF_TARGET），然后重试。
          </p>
          <div class="answer-actions">
            <button class="answer-back" @click="retrySubmit">重试</button>
            <button class="answer-back" @click="dismissError">返回游戏</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";

// WebGAL 网页版静态包挂在 Vite public/ 下，按 base 拼路径
const engineUrl = `${import.meta.env.BASE_URL}webgal/index.html`;
// /api-mist 前缀（与 projects.json 的 proxyApi 对齐，可用 VITE_API_MIST_BASE 覆盖）
const apiBase = import.meta.env.VITE_API_MIST_BASE || "/api-mist";
const galFrame = ref();
const frameSrc = ref(engineUrl);

// 答案判定结果页状态
const showResult = ref(false);
const resultData = ref({ answer: "", answerCorrect: false });

// 网络错误页状态
const showError = ref(false);
const pendingAnswer = ref("");

function backToGame() {
  showResult.value = false;
  reload();
}

function dismissError() {
  showError.value = false;
}

function retrySubmit() {
  showError.value = false;
  submitAnswer(pendingAnswer.value);
}

// 提交答案给后端（无状态判题），成功展示结果页，失败展示网络错误页
function submitAnswer(answer) {
  fetch(`${apiBase}/submit-answer?answer=${encodeURIComponent(answer)}`, { method: "POST" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!data || typeof data.answerCorrect !== "boolean") {
        throw new Error("响应格式错误");
      }
      const correct = data.answerCorrect;
      console.log("[host] 后端判定:", JSON.stringify(data));
      // 不重载 iframe：先展示判定结果页，玩家点击按钮后再回到游戏。
      resultData.value = { answer, answerCorrect: correct };
      showResult.value = true;
    })
    .catch((err) => {
      console.warn("[host] 后端不可达:", err.message);
      pendingAnswer.value = answer;
      showError.value = true;
    });
}

function reload() {
  // 先卸载 iframe 再重新加载，引擎重新进入开场剧情
  frameSrc.value = "";
  watchedDoc = null;
  setTimeout(() => {
    frameSrc.value = engineUrl;
  }, 50);
}

defineExpose({ reload });

// ===== 宿主捕获引擎 getUserInput 的答案，交给后端判定 =====
// 实测发现：本引擎版本（4.6.4）的 changeScene 不做 {变量} 插值，且 choose 的
// 目标会被「:」截断、不能是完整 URL。因此「答案 → 后端校验」改由宿主完成：
// 监听 iframe（同源）内的「提交」点击，把答案 POST 给 /api-mist/submit-answer。
// 后端无状态，只返回本次判定（{ ok, answerCorrect }）。
let captureTimer;
let watchedDoc = null;

function armCapture() {
  const doc = galFrame.value?.contentDocument;
  if (!doc || watchedDoc === doc) return;
  if (!doc.querySelector("input, textarea")) return;
  watchedDoc = doc;
  doc.addEventListener("click", onDialogClick, true);
}

function onDialogClick(e) {
  const doc = watchedDoc;
  if (!doc) return;
  let el = e.target;
  let isSubmit = false;
  for (let i = 0; el && i < 4; i += 1, el = el.parentElement) {
    if ((el.textContent || "").trim() === "提交") {
      isSubmit = true;
      break;
    }
  }
  if (!isSubmit) return;
  // 引擎输入框固定 id 为 user-input：优先读它，避免文档里其他 input 干扰
  const input =
    doc.querySelector("#user-input") || doc.querySelector("input, textarea");
  const answer = (input?.value || "").trim();
  console.log("[host] 捕获到答案:", JSON.stringify(answer));
  if (!answer) return;
  submitAnswer(answer);
}

onMounted(() => {
  captureTimer = setInterval(armCapture, 400);
});

onBeforeUnmount(() => {
  clearInterval(captureTimer);
});
</script>

<style scoped>
.gal-page {
  width: 100%;
}

.gal-stage {
  position: relative;
  width: min(100vw, calc(100vh * 16 / 9));
  margin: 0 auto;
  overflow: hidden;
  background: #000;
}

.gal-frame {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
}

.gal-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  color: var(--muted);
  font-size: 14px;
}

/* ===== 答案判定结果页 ===== */
.answer-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 13, 19, 0.72);
  backdrop-filter: blur(4px);
}

.answer-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 300px;
  padding: 28px 40px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  text-align: center;
}

.answer-card.is-ok {
  border-color: rgba(53, 194, 123, 0.6);
}

.answer-card.is-no {
  border-color: rgba(224, 90, 90, 0.6);
}

.answer-card.is-err {
  border-color: rgba(224, 160, 80, 0.6);
}

.answer-actions {
  display: flex;
  gap: 10px;
}

.answer-icon {
  font-size: 36px;
  line-height: 1;
}

.answer-title {
  font-size: 20px;
}

.answer-sub {
  color: var(--muted);
  font-size: 14px;
}

.answer-sub strong {
  color: var(--text);
}

.answer-hint {
  color: var(--muted);
  font-size: 13px;
}

.answer-back {
  margin-top: 6px;
  padding: 8px 24px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #1d2330;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}

.answer-back:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
