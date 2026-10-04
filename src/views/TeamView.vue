<script setup>
import { ref } from "vue";
import { useGameState } from "@/composables/useGameState";

const emit = defineEmits(["close"]);

const {
  state,
  createTeam,
  joinTeam,
  leaveTeam,
  submitTeamApplication,
  handleTeamApplication,
} = useGameState();

const createTeamName = ref("");
const createTeamCode = ref("");
const joinTeamCode = ref("");
const teamApplyMessage = ref("");
const teamNotice = ref("");

function handleCreateTeam() {
  if (!state.user.currentUser) {
    teamNotice.value = "请先登录后再创建队伍。";
    return;
  }

  const result = createTeam(createTeamName.value, createTeamCode.value);
  teamNotice.value = result.message;
  if (result.ok) {
    createTeamName.value = "";
    createTeamCode.value = "";
  }
}

function handleJoinTeam() {
  if (!state.user.currentUser) {
    teamNotice.value = "请先登录后再加入队伍。";
    return;
  }

  const result = joinTeam(joinTeamCode.value);
  teamNotice.value = result.message;
  if (result.ok) {
    joinTeamCode.value = "";
  }
}

function handleLeaveTeam() {
  const result = leaveTeam();
  teamNotice.value = result.message;
}

function handleTeamSubmit() {
  if (!state.user.currentUser) {
    teamNotice.value = "请先登录后再提交组队申请。";
    return;
  }

  const result = submitTeamApplication(teamApplyMessage.value);
  teamNotice.value = result.message;
  if (result.ok) {
    teamApplyMessage.value = "";
  }
}

function resolveApplication(applicationId, action) {
  const result = handleTeamApplication(applicationId, action);
  teamNotice.value = result.message;
}
</script>

<template>
  <section class="page-shell">
    <header class="page-shell__head">
      <div class="page-shell__title">
        <p class="page-shell__eyebrow">队伍管理</p>
        <h1>我的队伍</h1>
      </div>
    </header>

    <div class="page-shell__body">
      <div v-if="!state.user.currentUser" class="page-shell__column">
        <section class="panel-card">
          <p class="panel-card__label">组队状态</p>
          <p class="helper-text">请先登录后再进行组队操作。</p>
        </section>
      </div>

      <div v-else-if="!state.user.team.joined" class="page-shell__column">
        <section class="panel-card">
          <p class="panel-card__label">创建队伍</p>
          <div class="team-action-group">
            <input
              v-model="createTeamName"
              type="text"
              placeholder="队伍名称（可选）"
              class="team-input"
            />
            <input
              v-model="createTeamCode"
              type="text"
              placeholder="自定义队伍编号（可选）"
              class="team-input"
            />
            <button class="primary-button" type="button" @click="handleCreateTeam">
              创建队伍
            </button>
          </div>
        </section>

        <section class="panel-card">
          <p class="panel-card__label">加入队伍</p>
          <div class="team-action-group">
            <input
              v-model="joinTeamCode"
              type="text"
              placeholder="请输入队伍编号"
              class="team-input"
            />
            <button class="primary-button" type="button" @click="handleJoinTeam">
              加入队伍
            </button>
          </div>
        </section>
      </div>

      <div v-else class="page-shell__column">
        <section class="panel-card">
          <p class="panel-card__label">当前组队情况</p>
          <div class="team-summary">
            <div>
              <h2>{{ state.user.team.name || "我的队伍" }}</h2>
              <p class="panel-card__meta">队伍编号 {{ state.user.team.code }}</p>
            </div>
            <button class="ghost-button" type="button" @click="handleLeaveTeam">
              退出队伍
            </button>
          </div>

          <ul class="member-list">
            <li v-for="member in state.user.team.members" :key="member.username">
              <span>{{ member.nickname }}</span>
              <small>{{ member.role }}</small>
            </li>
          </ul>
        </section>

        <section v-if="!state.user.team.joined" class="panel-card">
          <p class="panel-card__label">组队申请</p>

          <div class="apply-block">
            <textarea
              v-model="teamApplyMessage"
              rows="4"
              placeholder="写下你希望加入队伍的理由和能力..."
            />
            <button class="primary-button" type="button" @click="handleTeamSubmit">
              提交申请
            </button>
          </div>

          <ul v-if="state.user.team.applications.length" class="application-list">
            <li
              v-for="application in state.user.team.applications"
              :key="application.id"
              class="application-item"
            >
              <div class="application-item__head">
                <strong>{{ application.nickname }}</strong>
                <span :class="`status status--${application.status}`">
                  {{
                    application.status === "pending"
                      ? "待审核"
                      : application.status === "accepted"
                        ? "已接受"
                        : "已拒绝"
                  }}
                </span>
              </div>
              <p>{{ application.message }}</p>

              <div
                v-if="application.status === 'pending' && state.user.currentUser"
                class="application-item__actions"
              >
                <button
                  class="secondary-button"
                  type="button"
                  @click="resolveApplication(application.id, 'accept')"
                >
                  接受
                </button>
                <button
                  class="ghost-button"
                  type="button"
                  @click="resolveApplication(application.id, 'reject')"
                >
                  拒绝
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="helper-text">当前暂无组队申请。</p>
        </section>
      </div>
    </div>

    <p v-if="teamNotice" class="helper-text helper-text--note">{{ teamNotice }}</p>
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

.application-item__actions {
  display: flex;
  gap: 8px;
}

.helper-text--note {
  padding-top: 4px;
}
</style>
