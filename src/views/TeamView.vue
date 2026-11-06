<script setup>
// 我的队伍页：对接 /api/team/* 系列接口。
// 状态全部来自后端：currentTeam 为队伍对象，myJoinRequest 为未入队时的加入申请。
import { computed, onMounted, ref } from "vue";
import { useGameState } from "@/composables/useGameState";
import { router } from "@/router";
import { useNameAvailability } from "@/composables/useNameAvailability";
import { useStatusMessage } from "@/composables/useStatusMessage";
import { extractErrorMessage } from "@/api/errors";
import { teamApi } from "@/api/team";
import { normalizeTeamName, validateTeamName } from "@/config/team";
import NameStatus from "@/components/NameStatus.vue";
import StatusMessage from "@/components/StatusMessage.vue";
import UserTabs from "@/components/UserTabs.vue";

const {
  state,
  currentTeam,
  myJoinRequest,
  isTeamCaptain,
  teamLocked,
  teamPendingRequests,
  loadMyTeam,
  createTeam,
  joinTeam,
  rotateInviteCode,
  setAutoApprove,
  confirmJoinRequest,
  rejectJoinRequest,
  cancelJoinRequest,
  startTeam,
  cancelStartTeam,
  removeMember,
  leaveTeam,
  transferCaptain,
  dissolveTeam,
} = useGameState();

const loading = ref(false);
const busy = ref("");
// 队伍操作结果提示：文案与语义色统一由 useStatusMessage 管理。
const {
  message: teamNotice,
  tone: noticeType,
  set: setNotice,
} = useStatusMessage();

const createTeamName = ref("");
const createTeamIntro = ref("");
const joinCode = ref("");

// 队名实时查重：本地规则即时反馈（emoji / 换行等不必等提交），规则通过后防抖查唯一性。
const {
  status: teamNameStatus,
  message: teamNameMessage,
  reset: resetTeamNameState,
  setStatus: setTeamNameState,
} = useNameAvailability({
  value: createTeamName,
  validate: validateTeamName,
  normalize: normalizeTeamName,
  check: (name) => teamApi.nameAvailable(name),
  // 后端返回的是 NFC + 去首尾空白后的值，必要时回写输入框。
  writeBack: true,
  messages: {
    checking: "正在检查队名...",
    available: "队名可以使用。",
    taken: "该队名已被占用，换一个吧。",
    error: "队名检查暂不可用，可直接尝试建队。",
  },
});

const isLoggedIn = computed(() => Boolean(state.user.currentUser));
const members = computed(() => currentTeam.value?.members ?? []);
const currentAccountId = computed(() => state.user.currentUser?.id ?? null);

// 队伍封禁（status=4）：只锁参赛与队伍结构（建队 / 加入 / 队伍结构操作 / 退队 / 取题提交），
// 站内信、求提示的后续动作、账号设置等都不受影响（api-11 限制矩阵）。
const teamBanned = computed(
  () =>
    state.accountStatus?.team?.status === 4 ||
    currentTeam.value?.status === 4,
);
// 队伍级禁言（status=3 或 /me/status 的 team.muted）：只关发信与求提示提问，其余不受影响。
// 展示优先级与拦截一致：封禁 > 禁言。
const teamMuted = computed(
  () =>
    !teamBanned.value &&
    Boolean(
      state.accountStatus?.team?.muted || currentTeam.value?.status === 3,
    ),
);
const teamMutedReason = computed(() => {
  const info = state.accountStatus?.team;
  const until = info?.until
    ? `至 ${new Date(info.until).toLocaleString("zh-CN", { hour12: false })} 自动解除`
    : "长期（不会自动解除）";
  const reason = info?.reason ? `原因：${info.reason} · ` : "";
  return `${reason}${until}。禁言只关闭发信与求提示提问，读信、账号设置与队伍结构操作不受影响。`;
});
const teamBannedReason = computed(() => {
  const info = state.accountStatus?.team;
  const until = info?.until
    ? `至 ${new Date(info.until).toLocaleString("zh-CN", { hour12: false })} 自动解封`
    : "长期封禁";
  const reason = info?.reason ? `原因：${info.reason} · ` : "";
  const appealHint = teamAppealAvailable.value
    ? ""
    : "队伍封禁申诉仅队长可提交。";
  return `${reason}${until}。队伍封禁只冻结参赛与队伍结构，读信与账号设置不受影响。${appealHint}`;
});
// 队伍封禁由队长代表队伍申诉（scope=team，kind=ban）：teamAppeal 有值即说明我是队长
const teamAppealAvailable = computed(() =>
  Boolean(state.accountStatus?.teamAppeal),
);

// 队伍结构类操作在封禁期间一律拦截（服务端也会返回 E_FORBIDDEN）
function blockIfTeamBanned() {
  if (!teamBanned.value) return false;
  setNotice("error", "队伍已被官方封禁，暂不能进行队伍结构操作。");
  return true;
}

// 我的加入申请状态文案。
const joinRequestStatusLabel = computed(() => {
  switch (myJoinRequest.value?.status) {
    case "pending":
      return "等待队长确认";
    case "rejected":
      return "申请已被拒绝，可改投其他队伍";
    case "cancelled":
      return "申请已取消";
    default:
      return "";
  }
});

// 统一执行一个队伍操作：串行化并显示忙状态，成功/失败都写入提示。
async function run(key, action) {
  if (busy.value) {
    return { ok: false };
  }

  busy.value = key;
  try {
    const result = await action();
    setNotice(result?.ok ? "success" : "error", result?.message ?? "");
    return result ?? { ok: false };
  } catch (error) {
    setNotice("error", extractErrorMessage(error, "操作失败，请稍后再试。"));
    return { ok: false };
  } finally {
    busy.value = "";
  }
}

function refreshTeam() {
  if (loading.value) {
    return;
  }

  loading.value = true;
  loadMyTeam()
    .then((result) => {
      if (!result.ok) {
        setNotice("error", result.message);
      }
    })
    .finally(() => {
      loading.value = false;
    });
}

onMounted(() => {
  if (isLoggedIn.value) {
    refreshTeam();
  }
});

function roleLabel(role) {
  return role === "captain" ? "队长" : "成员";
}

function isMe(member) {
  return String(member.accountId) === String(currentAccountId.value);
}

async function handleCreateTeam() {
  if (blockIfTeamBanned()) return;

  const validation = validateTeamName(createTeamName.value);
  if (!validation.ok) {
    setTeamNameState("invalid", validation.message);
    setNotice("error", validation.message);
    return;
  }

  const result = await run("create", () =>
    createTeam(validation.value, createTeamIntro.value),
  );

  if (result.ok) {
    createTeamName.value = "";
    createTeamIntro.value = "";
    setTeamNameState("idle");
    return;
  }

  // 把队名相关的原因落到输入框下方：400 的 detail.fields.name，或 409 的「该队名已被占用」。
  const conflictOnName =
    result.code === "E_CONFLICT" && String(result.message || "").includes("队名");
  const nameError = result.nameError || (conflictOnName ? result.message : "");
  if (nameError) {
    resetTeamNameState();
    setTeamNameState("taken", nameError);
  }
}

async function handleJoin() {
  if (blockIfTeamBanned()) return;

  const result = await run("join", () => joinTeam(joinCode.value));
  if (result.ok) {
    joinCode.value = "";
  }
}

function handleToggleAutoApprove() {
  if (blockIfTeamBanned()) return;

  run("auto", () => setAutoApprove(!currentTeam.value?.autoApprove));
}

function handleLeaveTeam() {
  if (blockIfTeamBanned()) return;

  if (!window.confirm("确定要退出当前队伍吗？")) {
    return;
  }

  run("leave", () => leaveTeam());
}

function handleDissolve() {
  if (blockIfTeamBanned()) return;

  if (!window.confirm("确定要解散队伍吗？该操作不可撤销。")) {
    return;
  }

  run("dissolve", () => dissolveTeam());
}

function handleStart() {
  if (blockIfTeamBanned()) return;

  if (
    !window.confirm(
      "确认参赛后队伍将进入锁定态，无法再拉人 / 踢人 / 退队 / 转让 / 解散。确定继续？",
    )
  ) {
    return;
  }

  run("start", () => startTeam());
}

function handleRemoveMember(member) {
  if (blockIfTeamBanned()) return;

  if (!window.confirm(`确定要移出成员「${member.username}」吗？`)) {
    return;
  }

  run(`remove-${member.accountId}`, () => removeMember(member.accountId));
}

function handleTransfer(member) {
  if (blockIfTeamBanned()) return;

  if (!window.confirm(`确定要把队长转让给「${member.username}」吗？`)) {
    return;
  }

  run(`transfer-${member.accountId}`, () => transferCaptain(member.accountId));
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">队伍管理</p>
        <h1>我的队伍</h1>
      </div>
      <button
        v-if="isLoggedIn"
        class="ghost-button"
        type="button"
        :disabled="loading || Boolean(busy)"
        @click="refreshTeam"
      >
        刷新
      </button>
    </header>

    <UserTabs />

    <!-- 队伍封禁：只冻结参赛与队伍结构，读信 / 求提示后续动作 / 账号设置不受影响；队长可代表队伍申诉 -->
    <div v-if="isLoggedIn && teamBanned" class="banned-banner">
      <strong>队伍已被官方封禁</strong>
      <span>{{ teamBannedReason }}</span>
      <button
        v-if="teamAppealAvailable"
        class="banned-banner__action"
        type="button"
        @click="router.goToRoute('/appeal')"
      >
        代表队伍申诉
      </button>
    </div>
    <!-- 队伍禁言：只关发信与求提示提问 -->
    <div v-else-if="isLoggedIn && teamMuted" class="muted-banner">
      <strong>队伍已被禁言</strong>
      <span>{{ teamMutedReason }}</span>
    </div>

    <div class="page-shell__body">
      <!-- 未登录 -->
      <div v-if="!isLoggedIn" class="page-shell__column">
        <section class="panel-card">
          <p class="panel-card__label">组队状态</p>
          <p class="helper-text">请先登录后再进行组队操作。</p>
        </section>
      </div>

      <!-- 加载中 -->
      <div v-else-if="loading" class="page-shell__column page-shell__column--static">
        <section class="panel-card">
          <p class="helper-text">正在加载队伍信息...</p>
        </section>
      </div>

      <!-- 未入队 -->
      <div v-else-if="!currentTeam" class="page-shell__column">
        <section v-if="myJoinRequest" class="panel-card">
          <p class="panel-card__label">我的加入申请</p>
          <div class="team-summary">
            <div>
              <h2>{{ myJoinRequest.teamName || "队伍" }}</h2>
              <p class="panel-card__meta">{{ joinRequestStatusLabel }}</p>
            </div>
            <button
              v-if="myJoinRequest.status === 'pending'"
              class="ghost-button"
              type="button"
              :disabled="Boolean(busy)"
              @click="run('cancel', cancelJoinRequest)"
            >
              {{ busy === "cancel" ? "取消中..." : "取消申请" }}
            </button>
          </div>
        </section>

        <section class="panel-card panel-card--static">
          <p class="panel-card__label">创建队伍</p>
          <div class="team-action-group">
            <input
              id="create-team-name"
              v-model="createTeamName"
              type="text"
              maxlength="32"
              placeholder="队伍名称（必填，1–32 字）"
              aria-label="队伍名称"
              class="team-input"
              :aria-describedby="
                teamNameMessage ? 'create-team-name-status' : undefined
              "
            />
            <NameStatus
              id="create-team-name-status"
              :status="teamNameStatus"
              :message="teamNameMessage"
            />
            <input
              v-model="createTeamIntro"
              type="text"
              maxlength="200"
              placeholder="队伍简介（可选，最多 200 字）"
              aria-label="队伍简介"
              class="team-input"
            />
            <button
              class="primary-button"
              type="button"
              :disabled="Boolean(busy)"
              @click="handleCreateTeam"
            >
              {{ busy === "create" ? "创建中..." : "创建队伍" }}
            </button>
          </div>
        </section>

        <section class="panel-card panel-card--static">
          <p class="panel-card__label">加入队伍</p>
          <div class="team-action-group">
            <input
              v-model="joinCode"
              aria-label="邀请码"
              type="text"
              placeholder="请输入 8 位邀请码"
              class="team-input"
            />
            <button
              class="primary-button"
              type="button"
              :disabled="Boolean(busy)"
              @click="handleJoin"
            >
              {{ busy === "join" ? "提交中..." : "加入队伍" }}
            </button>
          </div>
          <p class="helper-text">
            凭邀请码加入默认为提交「加入申请」；若队长已开启自动审批，则会直接入队。
          </p>
        </section>
      </div>

      <!-- 已入队 -->
      <div v-else class="page-shell__column">
        <section class="panel-card">
          <p class="panel-card__label">当前组队情况</p>
          <div class="team-summary">
            <div>
              <h2>{{ currentTeam.name }}</h2>
              <p v-if="currentTeam.intro" class="panel-card__meta">{{ currentTeam.intro }}</p>
              <p class="panel-card__meta">
                成员 {{ members.length }}/{{ currentTeam.maxSize ?? 5 }} · 已解
                {{ currentTeam.progress?.solvedCount ?? 0 }} 题 · 得分
                {{ currentTeam.progress?.score ?? 0 }}
              </p>
            </div>
            <span :class="['status', teamLocked ? 'status--locked' : 'status--pending']">
              {{ teamLocked ? "已确认参赛" : "未确认参赛" }}
            </span>
          </div>

          <p v-if="currentTeam.inviteCode" class="panel-card__meta">
            邀请码：<code class="invite-code">{{ currentTeam.inviteCode }}</code>
          </p>
          <p v-else class="panel-card__meta">邀请码仅本队成员可见。</p>

          <div v-if="isTeamCaptain" class="inline-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="Boolean(busy) || teamLocked"
              @click="run('invite', rotateInviteCode)"
            >
              {{ busy === "invite" ? "更换中..." : "更换邀请码" }}
            </button>
            <button
              class="secondary-button"
              type="button"
              :disabled="Boolean(busy) || teamLocked"
              @click="handleToggleAutoApprove"
            >
              {{ currentTeam.autoApprove ? "关闭自动审批" : "开启自动审批" }}
            </button>
          </div>
        </section>

        <section class="panel-card">
          <p class="panel-card__label">成员</p>
          <ul class="member-list">
            <li v-for="member in members" :key="member.accountId">
              <div class="member-meta">
                <strong>{{ member.username }}</strong>
                <small>{{ member.playerNo }} · {{ roleLabel(member.role) }}</small>
              </div>
              <div
                v-if="isTeamCaptain && !teamLocked && !isMe(member)"
                class="inline-actions"
              >
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="Boolean(busy)"
                  @click="handleTransfer(member)"
                >
                  转让队长
                </button>
                <button
                  class="ghost-button"
                  type="button"
                  :disabled="Boolean(busy)"
                  @click="handleRemoveMember(member)"
                >
                  移出
                </button>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="isTeamCaptain" class="panel-card">
          <p class="panel-card__label">待处理加入申请</p>
          <ul v-if="teamPendingRequests.length" class="application-list">
            <li
              v-for="request in teamPendingRequests"
              :key="request.id"
              class="application-item"
            >
              <div class="application-item__head">
                <strong>{{ request.username }}</strong>
                <small>{{ request.playerNo }}</small>
              </div>
              <div class="application-item__actions">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="Boolean(busy) || teamLocked"
                  @click="run(`confirm-${request.id}`, () => confirmJoinRequest(request.id))"
                >
                  同意
                </button>
                <button
                  class="ghost-button"
                  type="button"
                  :disabled="Boolean(busy) || teamLocked"
                  @click="run(`reject-${request.id}`, () => rejectJoinRequest(request.id))"
                >
                  拒绝
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="helper-text">当前暂无待处理申请。</p>
        </section>

        <section class="panel-card">
          <p class="panel-card__label">参赛与队伍</p>
          <div class="inline-actions">
            <button
              v-if="!teamLocked && isTeamCaptain"
              class="primary-button"
              type="button"
              :disabled="Boolean(busy)"
              @click="handleStart"
            >
              {{ busy === "start" ? "确认中..." : "确认参赛" }}
            </button>
            <button
              v-if="teamLocked && isTeamCaptain"
              class="secondary-button"
              type="button"
              :disabled="Boolean(busy)"
              @click="run('cancel-start', cancelStartTeam)"
            >
              取消确认参赛
            </button>
            <button
              class="ghost-button"
              type="button"
              :disabled="Boolean(busy) || teamLocked"
              @click="handleLeaveTeam"
            >
              退出队伍
            </button>
            <button
              v-if="isTeamCaptain"
              class="ghost-button"
              type="button"
              :disabled="Boolean(busy) || teamLocked"
              @click="handleDissolve"
            >
              解散队伍
            </button>
          </div>
          <p v-if="teamLocked" class="helper-text">
            队伍已确认参赛并锁定：无法再拉人 / 踢人 / 退队 / 转让 / 解散。
          </p>
        </section>
      </div>
    </div>

    <StatusMessage
      class="team-notice"
      :message="teamNotice"
      :tone="noticeType"
    />
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

.page-shell__column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(700px, 100%);
}

.panel-card {
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

.panel-card h2 {
  margin: 0;
  font-size: 24px;
}

.panel-card__meta,
.helper-text {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

.team-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.team-action-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.team-input,
textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(8, 13, 20, 0.12);
  color: var(--text);
  box-sizing: border-box;
}

textarea {
  resize: vertical;
}

.member-list,
.application-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.member-list li,
.application-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.member-list li small {
  color: var(--text-dim);
}

.apply-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.primary-button,
.secondary-button,
.ghost-button,
.bar-btn {
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
}

.secondary-button {
  width: fit-content;
}

.ghost-button {
  color: var(--text-dim);
}

.application-item {
  flex-direction: column;
  align-items: stretch;
}

.application-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.application-item p {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
}

.status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 10px;
  border: 1px solid transparent;
}

/* 队伍封禁提示条：说明封禁只影响参赛与队伍结构 */
.banned-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 12px;
  padding: 10px 14px;
  border: 1px solid rgba(224, 49, 49, 0.55);
  border-radius: 10px;
  background: rgba(224, 49, 49, 0.12);
  font-size: 13px;
  line-height: 1.7;
}

.banned-banner__action {
  margin-left: auto;
  padding: 4px 12px;
  border: 1px solid rgba(224, 49, 49, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.banned-banner__action:hover {
  background: rgba(224, 49, 49, 0.22);
}

/* 队伍禁言提示条：比封禁弱一级 */
.muted-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 12px;
  padding: 10px 14px;
  border: 1px solid rgba(240, 173, 78, 0.6);
  border-radius: 10px;
  background: rgba(240, 173, 78, 0.12);
  font-size: 13px;
  line-height: 1.7;
}

.status--pending {
  border-color: rgba(255, 193, 7, 0.45);
  color: #f1c75d;
}

.status--accepted {
  border-color: rgba(76, 175, 80, 0.45);
  color: #6ed791;
}

.status--rejected {
  border-color: rgba(255, 107, 107, 0.42);
  color: #ff9d9d;
}

.status--locked {
  border-color: rgba(110, 171, 255, 0.45);
  color: #9dc2ff;
}

.application-item__actions {
  display: flex;
  gap: 8px;
}

.member-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.invite-code {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.08em;
  color: var(--text);
}

/* 队伍操作结果提示：与内容列同宽居中。 */
.team-notice {
  width: min(700px, 100%);
  margin: 0 auto;
}

/* ---------- 入场动效：页面既有元素自下向上浮现（不新增任何装饰节点） ---------- */

@keyframes team-rise-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 卡片内部与列表行位移更小，避免和卡片本身的浮起叠加得过于夸张。 */
@keyframes team-rise-soft {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 页头与用户导航保持静态（与其他功能页一致），只有提示条参与浮现。 */
.banned-banner,
.muted-banner,
.team-notice {
  animation: team-rise-in 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) backwards;
}

.banned-banner,
.muted-banner {
  animation-delay: 0.04s;
}

.team-notice {
  animation-delay: 0.16s;
}

/* 内容列按顺序逐张浮起；--rise-delay 会向下继承，卡片内部沿用同一条时间轴。 */
.page-shell__column > * {
  --rise-delay: 0.06s;
  animation: team-rise-in 0.44s cubic-bezier(0.22, 0.61, 0.36, 1)
    var(--rise-delay) backwards;
}

.page-shell__column > :nth-child(2) {
  --rise-delay: 0.12s;
}

.page-shell__column > :nth-child(3) {
  --rise-delay: 0.18s;
}

.page-shell__column > :nth-child(4) {
  --rise-delay: 0.24s;
}

.page-shell__column > :nth-child(5) {
  --rise-delay: 0.3s;
}

.page-shell__column > :nth-child(6) {
  --rise-delay: 0.36s;
}

/* 卡片内容：在所属卡片起步后再浮起，保证先后关系清晰。 */
.panel-card > * {
  animation: team-rise-soft 0.34s cubic-bezier(0.22, 0.61, 0.36, 1)
    calc(var(--rise-delay, 0s) + 0.12s) backwards;
}

.panel-card > :nth-child(2) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.16s);
}

.panel-card > :nth-child(3) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.2s);
}

.panel-card > :nth-child(4) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.24s);
}

/* 建队 / 加入队伍两块表单直接呈现，不做上浮：它们需要立刻可填写。 */
.page-shell__column > .panel-card--static,
.panel-card--static > * {
  animation: none;
}

/* 加载占位同理：只是等待提示，不要跟着浮现，加载完成后的正式内容才走入场动效。 */
.page-shell__column--static * {
  animation: none;
}

/* 成员 / 加入申请逐行浮起；超出六行后沿用同一档延迟，避免延迟无限增长。 */
.member-list li,
.application-item {
  animation: team-rise-soft 0.32s cubic-bezier(0.22, 0.61, 0.36, 1)
    calc(var(--rise-delay, 0s) + 0.26s) backwards;
}

.member-list li:nth-child(2),
.application-item:nth-child(2) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.305s);
}

.member-list li:nth-child(3),
.application-item:nth-child(3) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.35s);
}

.member-list li:nth-child(4),
.application-item:nth-child(4) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.395s);
}

.member-list li:nth-child(5),
.application-item:nth-child(5) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.44s);
}

.member-list li:nth-child(n + 6),
.application-item:nth-child(n + 6) {
  animation-delay: calc(var(--rise-delay, 0s) + 0.485s);
}

@media (prefers-reduced-motion: reduce) {
  .banned-banner,
  .muted-banner,
  .team-notice,
  .page-shell__column > *,
  .panel-card > *,
  .member-list li,
  .application-item {
    animation: none;
  }
}
</style>
