<script setup>
// 我的申诉（api-11-moderation-mute.md §三）：
//   scope=account → 我本人的账号级处罚（封禁 / 账号级禁言）
//   scope=team    → 队长代表队伍（队伍级禁言 / 队伍封禁）；服务端只在「我是队长 + 队伍有可申诉处罚」时给 teamAppeal
// 这三个 /me/* 接口是封禁账号唯一可用的接口族，所以本页在封禁状态下也必须能正常打开。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { meApi } from "@/api/me";
import { extractErrorMessage } from "@/api/errors";
import { useGameState } from "@/composables/useGameState";
import { useStatusMessage } from "@/composables/useStatusMessage";
import StatusMessage from "@/components/StatusMessage.vue";
import UserTabs from "@/components/UserTabs.vue";

const { state, refreshAccountStatus } = useGameState();

const loading = ref(true);
const submitting = ref(false);
const status = ref(null);
// 两个申诉主体各自的链条：{ scope, kind, teamId, appeal, mails }
const chains = ref({ account: null, team: null });
const scope = ref("account");
const content = ref("");
// 队伍申诉被服务端以 403 拒绝（非队长）时隐藏该页签
const teamScopeDenied = ref("");

const {
  message,
  tone,
  set: setMessage,
  clear: clearMessage,
} = useStatusMessage();

const isLoggedIn = computed(() => Boolean(state.user.currentUser));
const banned = computed(() => Boolean(status.value?.banned));
const muted = computed(() => Boolean(status.value?.muted));
const teamInfo = computed(() => status.value?.team || null);
// 队伍封禁（team.status=4）：全局门禁里只锁参赛与队伍结构，队长可代表队伍申诉
const teamBanned = computed(() => teamInfo.value?.status === 4);
// teamAppeal 非 null 才说明「我是队长且队伍有可申诉处罚（禁言 / 封禁）」，否则不给队伍申诉入口
const teamAppeal = computed(() => status.value?.teamAppeal || null);
const accountAppeal = computed(() => status.value?.appeal || null);

const chain = computed(() => chains.value[scope.value] || null);
const appeal = computed(() => chain.value?.appeal || null);
const mails = computed(() =>
  Array.isArray(chain.value?.mails) ? chain.value.mails : [],
);

function kindText(kind) {
  if (kind === "ban") return "封禁";
  if (kind === "mute") return "禁言";
  return "无";
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function untilText(value, verb) {
  if (!value) return `长期（不会自动${verb}）`;
  return `至 ${formatTime(value)} 前${verb}`;
}

// 顶部状态卡：账号封禁 > 队伍封禁 > 账号禁言 > 队伍禁言 > 正常
// （文档口径：封禁 > 禁言；同级别时账号级 > 队伍级）
const statusCard = computed(() => {
  if (banned.value) {
    return {
      tone: "danger",
      title: "账号已被封禁",
      detail: [
        status.value.ban_reason ? `原因：${status.value.ban_reason}` : "",
        untilText(status.value.ban_until, "解封"),
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (teamBanned.value) {
    return {
      tone: "danger",
      title: `队伍「${teamInfo.value.teamName || teamInfo.value.teamId}」已被封禁`,
      detail: [
        teamInfo.value.reason ? `原因：${teamInfo.value.reason}` : "",
        untilText(teamInfo.value.until, "解封"),
        // 队伍封禁只有队长能代表队伍申诉（scope=team，kind=ban）
        teamAppeal.value
          ? "你是队长，可代表队伍申诉"
          : "只有队长可以代表队伍申诉",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (status.value?.status === 3) {
    return {
      tone: "warning",
      title: "账号已被禁言",
      detail: [
        status.value.mute_reason ? `原因：${status.value.mute_reason}` : "",
        untilText(status.value.mute_until, "解除"),
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (teamInfo.value?.muted || teamInfo.value?.status === 3) {
    return {
      tone: "warning",
      title: `队伍「${teamInfo.value.teamName || teamInfo.value.teamId}」已被禁言`,
      detail: [
        teamInfo.value.reason ? `原因：${teamInfo.value.reason}` : "",
        untilText(teamInfo.value.until, "解除"),
        teamAppeal.value
          ? "你是队长，可代表队伍申诉"
          : "只有队长可以代表队伍申诉",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (muted.value) {
    return {
      tone: "warning",
      title: "当前处于禁言状态",
      detail: "发信入口已关闭，可在此查看与提交申诉。",
    };
  }
  return {
    tone: "ok",
    title: "账号状态正常",
    detail: "当前没有生效中的处罚。",
  };
});

const scopes = computed(() => {
  const list = [
    { value: "account", label: "账号申诉", appeal: accountAppeal.value },
  ];
  if (teamAppeal.value && !teamScopeDenied.value) {
    list.push({ value: "team", label: "队伍申诉", appeal: teamAppeal.value });
  }
  return list;
});

// 申诉主体默认落在「有可申诉处罚」的那一侧：只被队伍封禁的队长直接进队伍申诉。
// 用户手动切过主体后就不再自动跳转，避免状态轮询把页面切走。
const scopePicked = ref(false);

function scopeHasAppeal(value) {
  return Boolean(chains.value[value]?.appeal?.kind);
}

function selectScope(value) {
  scopePicked.value = true;
  scope.value = value;
}

function applyDefaultScope() {
  if (scopePicked.value || scopeHasAppeal(scope.value)) return;
  const fallback = scopes.value.find((item) => scopeHasAppeal(item.value));
  if (fallback) scope.value = fallback.value;
}

const appealStateText = computed(() => {
  const current = appeal.value;
  if (!current || !current.kind) return "";
  const map = {
    none: "当前无需申诉。",
    can_submit: `可以提交申诉（剩余 ${current.remaining}/${current.limit} 条）。`,
    awaiting_reply: "已提交的申诉正在等待官方反馈，官方回复后才能继续提交。",
    closed: "申诉通道已关闭（3 条额度用尽且官方已回复），请联系官方。",
  };
  return map[current.state] || "";
});

const canSubmit = computed(() => Boolean(appeal.value?.can_submit));

const submitDisabledReason = computed(() => {
  if (!isLoggedIn.value) return "登录后才能提交申诉。";
  if (!chain.value) return "正在加载申诉信息…";
  if (!appeal.value || !appeal.value.kind) {
    if (scope.value === "team") {
      return teamAppeal.value
        ? "当前队伍没有需要申诉的处罚。"
        : "只有队长可以代表队伍申诉。";
    }
    // 队伍封禁只能走队伍申诉：账号侧没有可申诉处罚时要说清楚，否则用户以为页面坏了
    if (teamBanned.value) {
      return teamAppeal.value
        ? "队伍封禁需由队长在「队伍申诉」中提交；账号侧没有可申诉的处罚。"
        : "队伍封禁只有队长可以代表队伍申诉，账号侧没有可申诉的处罚。";
    }
    return "当前账号没有需要申诉的处罚。";
  }
  if (canSubmit.value) return "";
  if (appeal.value.state === "awaiting_reply") {
    return "官方尚未回复上一条申诉，暂不能提交。";
  }
  if (appeal.value.state === "closed") {
    return "申诉通道已关闭，请联系官方。";
  }
  return "当前不能提交申诉。";
});

async function loadStatus() {
  try {
    const payload = await meApi.getStatus();
    status.value = payload?.data ?? null;
    // 队伍申诉入口消失（例如已解禁）时回落到账号申诉
    if (
      scope.value === "team" &&
      !status.value?.teamAppeal &&
      !teamScopeDenied.value
    ) {
      scope.value = "account";
    }
    return status.value;
  } catch (error) {
    setMessage("error", extractErrorMessage(error, "读取账号状态失败。"));
    return null;
  }
}

async function loadChain(target = scope.value) {
  try {
    const payload = await meApi.getAppeal(target);
    chains.value = {
      ...chains.value,
      [target]: payload?.data ?? {
        scope: target,
        kind: null,
        appeal: null,
        mails: [],
      },
    };
    if (target === "team") teamScopeDenied.value = "";
  } catch (error) {
    if (target === "team" && error?.status === 403) {
      // 403 = 只有队长可以代表队伍申诉：隐藏页签并回落到账号申诉
      teamScopeDenied.value = extractErrorMessage(
        error,
        "只有队长可以代表队伍申诉",
      );
      scope.value = "account";
      setMessage("info", teamScopeDenied.value);
      return;
    }
    setMessage(
      "error",
      error?.code === "E_BANNED"
        ? "账号已被封禁，仅可查看申诉。"
        : extractErrorMessage(error, "读取申诉记录失败。"),
    );
  }
}

async function refreshAll() {
  loading.value = true;
  try {
    await loadStatus();
    await loadChain("account");
    if (teamAppeal.value) await loadChain("team");
    applyDefaultScope();
  } finally {
    loading.value = false;
  }
}

// 切换主体时才需要拉另一条链（已拉过就直接用缓存）
watch(scope, async (next) => {
  clearMessage();
  if (!chains.value[next]) {
    await loadChain(next);
  }
});

async function submitAppeal() {
  if (submitting.value || !canSubmit.value) return;

  const text = String(content.value ?? "").trim();
  if (!text) {
    setMessage("error", "请填写申诉内容。");
    return;
  }
  if (text.length > 2000) {
    setMessage("error", "申诉内容最多 2000 字。");
    return;
  }

  const target = scope.value;
  submitting.value = true;
  setMessage("pending", "正在提交申诉，请稍候...");
  try {
    const payload = await meApi.submitAppeal({ content: text, scope: target });
    const data = payload?.data ?? {};
    content.value = "";
    setMessage(
      "success",
      `申诉已提交（${data.subject || "已收到"}），请等待官方回复。`,
    );
    await loadStatus();
    await loadChain(target);
    // 顶栏等处的处罚状态一起刷新
    refreshAccountStatus();
  } catch (error) {
    const code = error?.code || "";
    if (code === "E_CONFLICT") {
      setMessage("error", extractErrorMessage(error, "当前无法提交申诉。"));
    } else if (code === "E_QUOTA") {
      setMessage("error", "提交过于频繁，请稍后再试。");
    } else if (code === "E_VALIDATION") {
      setMessage("error", "申诉内容需为 1–2000 字。");
    } else if (error?.status === 403) {
      setMessage(
        "error",
        extractErrorMessage(error, "只有队长可以代表队伍申诉。"),
      );
      teamScopeDenied.value = "只有队长可以代表队伍申诉";
      scope.value = "account";
    } else {
      setMessage("error", extractErrorMessage(error, "申诉提交失败。"));
    }
    await loadStatus();
    await loadChain(scope.value);
  } finally {
    submitting.value = false;
  }
}

// ---------- 状态轮询 ----------
// 处罚可能被官方解除，也可能 until 到期自动解除；30 秒查一次，页面隐藏时暂停。
const STATUS_POLL_MS = 30000;
let timer = null;
let clearTimer = null;
let lastFingerprint = "";
// 组件是否已卸载：onMounted 里的 refreshAll 可能还没回来用户就离开了，
// 那条续体不能再往已卸载的组件上注册 interval / 监听器（否则永远清不掉）。
let disposed = false;

function fingerprint(value) {
  if (!value) return "";
  return [
    value.status ?? "",
    value.banned ? "1" : "0",
    value.muted ? "1" : "0",
    value.team?.status ?? "",
    value.team?.muted ? "1" : "0",
    value.appeal?.kind || "",
    value.appeal?.state || "",
    value.appeal?.used ?? "",
    value.teamAppeal?.kind || "",
    value.teamAppeal?.state || "",
    value.teamAppeal?.used ?? "",
  ].join("|");
}

async function pollStatus() {
  const next = await loadStatus();
  if (disposed || !next) return;
  const current = fingerprint(next);
  if (lastFingerprint && current !== lastFingerprint) {
    setMessage("info", "账号处罚状态已更新。");
    // 链请求也可能很慢：每一段 await 之后都要重新确认组件还在，
    // 否则卸载后的续体会在已销毁的组件上再排一个 6 秒的 clearTimer。
    await loadChain("account");
    if (disposed) return;
    if (teamAppeal.value) {
      await loadChain("team");
      if (disposed) return;
    }
    // 让全站门禁（禁言隐藏发信入口 / 封禁跳转）跟上
    refreshAccountStatus();
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => clearMessage(), 6000);
  }
  lastFingerprint = current;
}

function handleVisibilityChange() {
  if (!document.hidden) pollStatus();
}

onMounted(async () => {
  await refreshAll();
  // 请求期间用户已经离开：这时再注册的 interval / 监听器不会再有机会被清理
  if (disposed) return;
  lastFingerprint = fingerprint(status.value);
  timer = window.setInterval(() => {
    if (!document.hidden) pollStatus();
  }, STATUS_POLL_MS);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  disposed = true;
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  window.clearTimeout(clearTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">账户</p>
        <h1>我的申诉</h1>
      </div>
      <button
        class="secondary-button"
        type="button"
        :disabled="loading"
        @click="refreshAll"
      >
        {{ loading ? "刷新中..." : "刷新状态" }}
      </button>
    </header>

    <UserTabs />

    <div class="page-shell__body">
      <div class="panel-card panel-card--wide">
        <p v-if="!isLoggedIn" class="panel-card__label">
          当前未登录，无法查看账号状态。
        </p>

        <template v-else>
          <!-- 账号 / 队伍处罚状态 -->
          <div class="status-card" :class="`is-${statusCard.tone}`">
            <strong>{{ statusCard.title }}</strong>
            <span>{{ statusCard.detail }}</span>
          </div>

          <p v-if="banned" class="helper-text">
            账号封禁期间功能页全部不可用（403），仅申诉相关接口放行；
            仍可前往「注册 / 登录」页更换账号或重新登录。
          </p>
          <p v-else-if="teamBanned" class="helper-text">
            队伍封禁只冻结参赛与队伍结构（取题 / 提交、组队操作、申请加入），
            站内信、求提示的确认 / 议价 / 关闭、账号设置都不受影响。
            {{ teamAppeal
              ? "你是队长，可在下方「队伍申诉」中提交申诉，官方回复写在队伍频道（全队可见）。"
              : "队伍封禁只有队长可以代表队伍申诉。" }}
          </p>
          <p v-else-if="muted" class="helper-text">
            禁言期间只关闭发信通道：站内信与求提示的只读、确认报价 / 申请降价 / 关闭仍可用。
          </p>

          <!-- 申诉主体：账号申诉 / 队伍申诉（队长且队伍有可申诉处罚时出现） -->
          <div v-if="scopes.length > 1" class="scope-tabs">
            <button
              v-for="item in scopes"
              :key="item.value"
              type="button"
              :class="[
                'scope-tabs__btn',
                { 'is-active': scope === item.value },
              ]"
              @click="selectScope(item.value)"
            >
              {{ item.label }}
            </button>
          </div>

          <div class="meta-row">
            <span>处罚种类</span>
            <strong>{{ kindText(appeal?.kind) }}</strong>
            <span>申诉额度</span>
            <strong>
              {{ appeal?.used ?? 0 }}/{{ appeal?.limit ?? 3 }}
              （剩余 {{ appeal?.remaining ?? 0 }} 条）
            </strong>
          </div>

          <p v-if="appealStateText" class="helper-text">{{ appealStateText }}</p>

          <!-- 官方最近回复 -->
          <div v-if="appeal?.last_reply" class="reply-card">
            <p class="reply-card__label">官方最近回复</p>
            <p class="reply-card__subject">{{ appeal.last_reply.subject }}</p>
            <p class="reply-card__body">{{ appeal.last_reply.content }}</p>
            <p class="reply-card__time">
              {{ formatTime(appeal.last_reply.created_at) }}
            </p>
          </div>

          <!-- 申诉链 -->
          <p class="panel-card__label">申诉往来（{{ mails.length }} 条）</p>
          <ul v-if="mails.length" class="mail-list">
            <li
              v-for="item in mails"
              :key="item.id"
              :class="[
                'mail-item',
                item.from === 'official' ? 'is-official' : 'is-me',
              ]"
            >
              <div class="mail-item__head">
                <span class="mail-item__from">
                  {{ item.from === "official" ? "官方" : "我" }}
                </span>
                <time>{{ formatTime(item.created_at) }}</time>
              </div>
              <p class="mail-item__subject">{{ item.subject }}</p>
              <p class="mail-item__body">{{ item.content }}</p>
            </li>
          </ul>
          <p v-else class="helper-text">
            {{ loading ? "加载中..." : "还没有申诉记录。" }}
          </p>

          <!-- 提交 -->
          <p class="panel-card__label">
            提交{{ scope === "team" ? "队伍" : "账号" }}申诉
          </p>
          <p v-if="submitDisabledReason" class="helper-text">
            {{ submitDisabledReason }}
          </p>
          <template v-else>
            <textarea
              v-model="content"
              class="appeal-editor"
              rows="5"
              maxlength="2000"
              :placeholder="
                scope === 'team'
                  ? '请说明队伍情况（1–2000 字）。主题由系统生成，回复全队可见。'
                  : '请说明情况（1–2000 字）。主题由系统按处罚种类自动生成。'
              "
            ></textarea>
            <p class="helper-text">
              一次只能提交一条，官方回复后才能提交下一条；每类处罚最多 3 条。
            </p>
          </template>

          <StatusMessage :message="message" :tone="tone" />

          <button
            v-if="canSubmit"
            class="primary-button"
            type="button"
            :disabled="submitting"
            @click="submitAppeal"
          >
            {{ submitting ? "提交中..." : "提交申诉" }}
          </button>
        </template>
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
  width: min(760px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.panel-card__label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.status-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  font-size: 13px;
  line-height: 1.7;
}

.status-card.is-danger {
  border-color: rgba(224, 49, 49, 0.6);
  background: rgba(224, 49, 49, 0.12);
}

.status-card.is-warning {
  border-color: rgba(240, 173, 78, 0.6);
  background: rgba(240, 173, 78, 0.12);
}

.status-card.is-ok {
  border-color: rgba(47, 158, 68, 0.5);
  background: rgba(47, 158, 68, 0.1);
}

.scope-tabs {
  display: flex;
  gap: 8px;
}

.scope-tabs__btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.scope-tabs__btn.is-active {
  border-color: var(--border-strong);
  color: var(--text);
  font-weight: 600;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  font-size: 13px;
  color: var(--text-dim);
}

.meta-row strong {
  color: var(--text);
}

.helper-text {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.7;
}

.reply-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  background: rgba(15, 124, 255, 0.06);
}

.reply-card__label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}

.reply-card__subject {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.reply-card__body {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.reply-card__time {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}

.mail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.mail-item.is-official {
  border-color: rgba(15, 124, 255, 0.5);
}

.mail-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--text-dim);
}

.mail-item__from {
  font-weight: 600;
  color: var(--text);
}

.mail-item__subject {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.mail-item__body {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.appeal-editor {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(8, 13, 20, 0.12);
  color: var(--text);
  box-sizing: border-box;
  font: inherit;
  line-height: 1.8;
  resize: vertical;
}

.appeal-editor:focus {
  outline: none;
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px rgba(110, 171, 255, 0.18);
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
  transition: filter 0.2s ease, opacity 0.2s ease, border-color 0.2s ease;
}

.secondary-button {
  width: fit-content;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.7;
  cursor: wait;
}
</style>
