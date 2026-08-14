<template>
  <section class="gal-page">
    <div class="gal-toolbar">
      <span class="gal-state">
        <i class="dot" :class="{ on: frameSrc }" />
        引擎状态：{{ frameSrc ? "运行中" : "重新加载中…" }}
      </span>
      <div class="gal-actions">
        <button class="btn" @click="reload">🔄 重新加载引擎</button>
        <a class="btn btn-link" :href="engineUrl" target="_blank" rel="noreferrer">
          ↗ 新标签打开引擎
        </a>
      </div>
    </div>
    <p v-if="captureNote" class="capture-note">{{ captureNote }}</p>
    <div class="gal-stage">
      <iframe v-if="frameSrc" ref="galFrame" :src="frameSrc" class="gal-frame" allow="autoplay; fullscreen" />
      <div v-else class="gal-loading">正在重新拉取剧本…</div>
    </div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";

// WebGAL 网页版静态包挂在 Vite public/ 下，按 base 拼路径
const engineUrl = `${import.meta.env.BASE_URL}webgal/index.html`;
const galFrame = ref();
const frameSrc = ref(engineUrl);
const captureNote = ref("");

function reload() {
  // 方案 4（宿主驱动）：先卸载 iframe 再重新加载，
  // 引擎会重新请求 entry 剧本，后端此时按新状态下发对应分支
  frameSrc.value = "";
  watchedDoc = null;
  setTimeout(() => {
    frameSrc.value = engineUrl;
  }, 50);
}

defineExpose({ reload });

// ===== 方案 4：宿主捕获引擎 getUserInput 的答案，交给后端判定 =====
// 实测发现：本引擎版本（4.6.4）的 changeScene 不做 {变量} 插值，且 choose 的
// 目标会被「:」截断、不能是完整 URL。因此「答案 → 后端校验」改由宿主完成：
// 监听 iframe（同源）内的「提交」点击，把答案 POST 给 /api-mist/submit-answer，
// 后端更新状态后重载 iframe，由 entry 剧本按新状态下发对应分支。
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
  const input = doc.querySelector("input, textarea");
  const answer = (input?.value || "").trim();
  if (!answer) return;
  fetch(`/api-mist/submit-answer?answer=${encodeURIComponent(answer)}`, { method: "POST" })
    .then((res) => {
      if (!res.ok) return;
      captureNote.value = `答案「${answer}」已提交后端判定，正在重新下发剧本…`;
      reload();
    })
    .catch(() => {
      // 后端不可达（如静态托管）时不重载，交给引擎自身的静态回退剧本判定
    });
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
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.gal-state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6b7686;
}

.dot.on {
  background: #35c27b;
  box-shadow: 0 0 6px #35c27b;
}

.gal-actions {
  display: flex;
  gap: 8px;
}

.capture-note {
  padding: 8px 14px;
  border: 1px solid rgba(79, 140, 255, 0.45);
  border-radius: 8px;
  background: rgba(79, 140, 255, 0.1);
  color: var(--accent);
  font-size: 13px;
}

.gal-stage {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 12px;
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
</style>
