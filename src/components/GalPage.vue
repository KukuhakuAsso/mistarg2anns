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
            {{ resultData.answerCorrect ? "答案正确。" : "再想想，返回后可以重新输入。" }}
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
          <p class="answer-hint">
            请检查网络连接，然后保存重试。
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
import { authFetch, startGame, refreshToken, getQuest, getFlow } from "@/utils/authFetch.js";
import { normalizeAnswerLoose } from "@/utils/answerNormalizer.js";

// WebGAL 网页版静态包挂在 Vite public/ 下，按 base 拼路径
const engineUrl = `${import.meta.env.BASE_URL}webgal/index.html`;
// /api-mist 前缀（与 projects.json 的 proxyApi 对齐，可用 VITE_API_MIST_BASE 覆盖）
const apiBase = import.meta.env.VITE_API_MIST_BASE || "/api-mist";
const galFrame = ref();
const frameSrc = ref(engineUrl);
const currentQuestion = ref("start");

// 答案判定结果页状态
const showResult = ref(false);
const resultData = ref({ answer: "", answerCorrect: false });

// 网络错误页状态
const showError = ref(false);
const pendingAnswer = ref("");

// ===== quest 点触发 → getQuest =====
// 剧本里通过 `setVar:quest=<questId> -global;` 设置 quest 点。引擎会把全局变量
// 持久化到同源存储（IndexedDB：localforage 库 localforage / store keyvaluepairs，
// IndexedDB 不可用时落到 localStorage）。宿主轮询读取 globalGameVar.quest，
// 检测到新的 quest 点即调用 getQuest 获取该点对应题目。
let engineGameKey = "";
let questTimer;
let lastQuestPoint = null; // 已成功触发的 quest 点
let lastFailedQuest = null; // 最近失败的 quest 点（退避重试）
let lastFailTime = 0;

// 从引擎 config.txt 解析 Game_key（localforage 的存储键）
async function loadEngineGameKey() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}webgal/game/config.txt`);
    const text = await res.text();
    const m = text.match(/Game_key\s*:\s*([^;\s]+)/);
    engineGameKey = m?.[1] ?? "";
  } catch (error) {
    console.warn("[host] 无法读取引擎 config.txt:", error);
  }
}

let engineDb = null; // 缓存的 localforage IndexedDB 连接，避免轮询反复 open

// 打开/复用 localforage 的 IndexedDB 连接。
// 加超时兜底：若引擎长期占用连接导致新的 open 请求挂起，超时先返回 null，
// 由 readEngineVar 走 localStorage 兜底，避免轮询死锁；连接稍后若成功打开
// 仍会缓存，供后续轮询复用。
function openEngineDb() {
  return new Promise((resolve) => {
    if (engineDb) return resolve(engineDb);
    try {
      const openReq = indexedDB.open("localforage");
      const timer = setTimeout(() => resolve(null), 2000);
      openReq.onsuccess = () => {
        clearTimeout(timer);
        engineDb = openReq.result;
        resolve(engineDb);
      };
      openReq.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

// 解析 localforage 存储的用户数据记录。
// 引擎用 localforage.setItem(Game_key, userData) 持久化（userData 含 globalGameVar）。
// 宿主绕过 localforage 直接读原始存储，读到的可能是：
//   - IndexedDB driver：直接存对象（实测本引擎/浏览器下为对象）
//   - localStorage driver：JSON 字符串
// 这里两种都兼容。
function parseEngineRecord(rec) {
  if (typeof rec === "string") {
    try {
      return JSON.parse(rec);
    } catch {
      return null;
    }
  }
  return rec && typeof rec === "object" ? rec : null;
}

// 读取引擎持久化的全局变量（IndexedDB 为主，localStorage 兜底）
async function readEngineVar(key) {
  if (!engineGameKey) return null;
  const db = await openEngineDb();
  if (!db) {
    // IndexedDB 不可用 → localStorage 兜底。
    // localforage 的 localStorage driver 的 key 带 "localforage/" 前缀。
    try {
      const raw = localStorage.getItem(`localforage/${engineGameKey}`);
      const data = parseEngineRecord(raw);
      return data?.globalGameVar?.[key] ?? null;
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("keyvaluepairs", "readonly");
      const store = tx.objectStore("keyvaluepairs");
      const getReq = store.get(engineGameKey);
      getReq.onsuccess = () => {
        try {
          const data = parseEngineRecord(getReq.result);
          resolve(data?.globalGameVar?.[key] ?? null);
        } catch {
          resolve(null);
        }
      };
      getReq.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// 触发 quest 点：调用 getQuest 获取题目并更新当前题目标识
async function triggerQuest(questPoint) {
  try {
    const data = await getQuest(questPoint);
    const resolved = data?.question ?? data?.id ?? data?.pointId ?? questPoint;
    if (typeof resolved === "string" && resolved.trim()) {
      currentQuestion.value = resolved;
    }
    console.log("[host] quest 点触发 getQuest:", questPoint, "→", currentQuestion.value, data);
    return true;
  } catch (error) {
    console.warn("[host] getQuest 失败:", questPoint, error?.message || error);
    return false;
  }
}

// 轮询引擎 quest 变量，检测到新 quest 点即触发 getQuest
async function pollQuestPoint() {
  const quest = await readEngineVar("quest");
  if (!quest || quest === lastQuestPoint) return;
  // 失败退避：同一个 quest 点 5 秒内不重复触发
  if (quest === lastFailedQuest && Date.now() - lastFailTime < 5000) return;
  const ok = await triggerQuest(quest);
  if (ok) {
    lastQuestPoint = quest;
    lastFailedQuest = null;
  } else {
    lastFailedQuest = quest;
    lastFailTime = Date.now();
  }
}

function handleFlowAction(data) {
  const action =
    typeof data?.action === "string"
      ? data.action
      : typeof data?.flowAction === "string"
        ? data.flowAction
        : "stay";

  switch (action) {
    case "return_to_input":
      showResult.value = false;
      resultData.value = { answer: "", answerCorrect: false };
      galFrame.value?.contentWindow?.focus?.();
      return true;
    case "restart":
      showResult.value = false;
      reload();
      return true;
    case "continue":
      showResult.value = false;
      return true;
    default:
      return false;
  }
}

function backToGame() {
  // 后端返回的 action 作为流程控制；没有显式 action 时默认返回当前输入状态。
  const nextAction = "return_to_input";
  if (!handleFlowAction({ action: nextAction })) {
    showResult.value = false;
    resultData.value = { answer: "", answerCorrect: false };
    galFrame.value?.contentWindow?.focus?.();
  }
}

function dismissError() {
  showError.value = false;
}

function retrySubmit() {
  showError.value = false;
  submitAnswer(pendingAnswer.value);
}

// 提交答案给后端，走统一的流程控制函数并按后端返回的 action 执行下一步。
// 提交前用 normalizeAnswerLoose 规范化（全角转半角、去空格与标点），
// 前后端判定、结果页展示与失败重试都使用规范化后的答案。
async function submitAnswer(answer) {
  const normalized = normalizeAnswerLoose(answer);
  if (!normalized) return;
  const question = currentQuestion.value || "start";

  try {
    const data = await getFlow(question, normalized);
    console.log("[host] 提交答案:", question, normalized, "→", data);
    console.log("[host] 当前quest位置:",currentQuestion.value, "引擎quest变量:", await readEngineVar("quest"));
    const hasResult = typeof data?.answerCorrect === "boolean";
    if (!hasResult) {
      throw new Error("响应格式错误");
    }

    const correct = data.answerCorrect;
    console.log("[host] 后端判定:", JSON.stringify(data));
    resultData.value = { answer: normalized, answerCorrect: correct };
    showResult.value = true;

    const flowData = {
      action: data.action ?? data.flowAction ?? "stay",
      message: data.message ?? "",
      nextScene: data.nextScene ?? "",
    };
    handleFlowAction(flowData);
  } catch (err) {
    console.warn("[host] 后端不可达:", err?.message || err);
    pendingAnswer.value = normalized;
    showError.value = true;
  }
}

function reload() {
  // 先卸载 iframe 再重新加载，引擎重新进入开场剧情
  frameSrc.value = "";
  watchedDoc = null;
  // 引擎重载后 quest 变量会重新写入，重置触发状态以重新 getQuest
  lastQuestPoint = null;
  lastFailedQuest = null;
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



onMounted(async () => {
  captureTimer = setInterval(armCapture, 400);
  questTimer = setInterval(pollQuestPoint, 500);

  try {
    await startGame();
    await loadEngineGameKey();
  } catch (error) {
    console.warn("[host] 初始化游戏会话失败:", error);
  }
});

// dev 热同步：vite.config.js 的 watch 插件在 game/ 内容变化后发送自定义事件。
//   - game-scene-refreshed：场景文件已通过 WebGAL 编辑器同步 V1 按场景刷新，
//     这里只需隐藏 iframe 内残留的引擎标题层（run-scene-content 不会隐藏它），
//     不重建 iframe、不刷新宿主页面。
//   - game-updated：config.txt / flowchart.json / 增删文件等，回退为整体重载 iframe。
if (import.meta.hot) {
  import.meta.hot.on("game-scene-refreshed", () => {
    const doc = galFrame.value?.contentDocument;
    const titleLayer = doc?.querySelector(".html-body__title-enter");
    if (titleLayer) titleLayer.style.display = "none";
    console.log("[host] 场景已按场景刷新，已隐藏标题层");
  });
  import.meta.hot.on("game-updated", () => {
    console.log("[host] 检测到游戏内容更新，重载游戏 iframe");
    reload();
  });
}

onBeforeUnmount(() => {
  clearInterval(captureTimer);
  clearInterval(questTimer);
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
