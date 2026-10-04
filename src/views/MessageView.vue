<script setup>
import { ref } from "vue";
import { useGameState } from "@/composables/useGameState";

const emit = defineEmits(["close"]);

const { state } = useGameState();
const activeTab = ref("inbox");
const mailEditor = ref(null);
const messageNotice = ref("");

const recipientLabel = state.user.currentUser
  ? `${state.user.currentUser.nickname}（${state.user.currentUser.username}）`
  : "管理员";

const inboxItems = [
  {
    id: 1,
    sender: "Copilot",
    subject: "Re: KukuhakuAsso/mistarg2anns feature/blackboard",
    preview: "Completed the team page flow and adjusted the desktop menu behavior for archive fallback.",
    time: "2025-03-28 10:26",
    unread: true,
    starred: false,
  },
  {
    id: 2,
    sender: "GitHub",
    subject: "Pull request update",
    preview: "Your review was requested on a recent pull request for the message page refinement.",
    time: "2025-03-27 18:40",
    unread: false,
    starred: false,
  },
  {
    id: 3,
    sender: "CloudDNS",
    subject: "Domain verification reminder",
    preview: "A new DNS validation request was generated for your project. Please review the records.",
    time: "2025-03-26 11:05",
    unread: true,
    starred: true,
  },
  {
    id: 4,
    sender: "Google",
    subject: "Security alert",
    preview: "A new sign-in was detected on your account from an unrecognized device.",
    time: "2025-03-25 09:18",
    unread: false,
    starred: false,
  },
  {
    id: 5,
    sender: "Fanita",
    subject: "Project follow-up",
    preview: "The draft of the message center is ready. Please confirm the final wording before sending.",
    time: "2025-03-24 15:42",
    unread: true,
    starred: true,
  },
];

function switchTab(tab) {
  activeTab.value = tab;
  messageNotice.value = "";
}

function handleSendMessage() {
  const content = (mailEditor.value?.innerText ?? "").replace(/\s+/g, " ").trim();

  if (!content) {
    messageNotice.value = "正文不能为空。";
    return;
  }

  state.unreadMessages = 0;
  messageNotice.value = `已发送站内信给 ${recipientLabel}。`;
  mailEditor.value.innerHTML = "";
}
</script>

<template>
  <section class="mail-app">
    <header class="topbar">

      <div class="topbar__nav">
        <button
          type="button"
          :class="['nav-btn', { 'is-active': activeTab === 'compose' }]"
          @click="switchTab('compose')"
        >
          写信
        </button>
        <button
          type="button"
          :class="['nav-btn', { 'is-active': activeTab === 'inbox' }]"
          @click="switchTab('inbox')"
        >
          收信
        </button>
      </div>

      <div class="topbar__right">
        <span class="user-chip">{{ recipientLabel }}</span>
        <button class="mini-btn" type="button" @click="emit('close')">返回</button>
      </div>
    </header>

    <div v-if="activeTab === 'compose'" class="mail-shell compose-shell">
      <main class="composer">
        <div class="mail-meta">
          <div class="mail-row">
            <span class="label">收件人</span>
            <span class="value">{{ recipientLabel }}</span>
          </div>
          <div class="mail-row">
            <span class="label">主题</span>
            <span class="value">站内信</span>
          </div>
        </div>

        <div class="toolbar">
          <span class="toolbar-label">正文</span>
        </div>

        <div
          ref="mailEditor"
          class="mail-editor"
          contenteditable="true"
          spellcheck="true"
          tabindex="0"
          aria-label="邮件正文"
        ></div>

        <div class="composer__footer">
          <button class="primary-btn" type="button" @click="handleSendMessage">
            发送
          </button>
        </div>

        <p v-if="messageNotice" class="helper-text">{{ messageNotice }}</p>
      </main>
    </div>

    <div v-else class="mail-shell inbox-shell">
      <main class="inbox-panel">
        <header class="inbox-toolbar">
          <div class="toolbar-group">
            <button class="soft-btn" type="button">全部</button>
            <button class="soft-btn" type="button">未读</button>
            <button class="soft-btn" type="button">已读</button>
          </div>
          <div class="toolbar-group toolbar-group--right">
            <button class="soft-btn" type="button">筛选</button>
            <button class="soft-btn" type="button">刷新</button>
          </div>
        </header>

        <div class="inbox-list">
          <div class="inbox-row inbox-row--head">
            <span class="inbox-check"></span>
            <span class="inbox-sender">发件人</span>
            <span class="inbox-subject">主题</span>
            <span class="inbox-time">时间</span>
          </div>

          <div
            v-for="item in inboxItems"
            :key="item.id"
            :class="['inbox-row', { 'is-unread': item.unread }]"
          >
            <span class="inbox-check"><input type="checkbox" /></span>
            <span class="inbox-sender">{{ item.sender }}</span>
            <span class="inbox-subject">
              <strong>{{ item.subject }}</strong>
              <small>{{ item.preview }}</small>
            </span>
            <span class="inbox-time">{{ item.time }}</span>
          </div>
        </div>
      </main>
    </div>
  </section>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #edf1f6;
}

.mail-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #eef3f8;
  color: #1f2430;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-bottom: 1px solid rgba(20, 37, 62, 0.08);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
}

.brand-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
}

.brand-mark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #1d9bf0, #0d6adf);
  color: white;
  font-weight: 700;
}

.brand-text {
  font-size: 24px;
  font-weight: 700;
  color: #1d6fe7;
}

.topbar__nav {
  display: flex;
  gap: 8px;
  flex: 1;
  justify-content: center;
}

.nav-btn,
.mini-btn,
.primary-btn,
.soft-btn {
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.15s ease;
}

.nav-btn {
  padding: 8px 14px;
  background: transparent;
  color: #4b5563;
}

.nav-btn.is-active {
  background: #edf4ff;
  color: #1d6fe7;
  border-color: rgba(29, 111, 231, 0.15);
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  font-size: 12px;
  color: #475569;
}

.mini-btn {
  padding: 7px 12px;
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.08);
}

.mail-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  background: #f3f6fa;
}

.compose-shell {
  padding: 0;
}

.composer {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.5);
  min-width: 0;
}

.mail-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px 10px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.mail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.label {
  width: 70px;
  color: #64748b;
  font-size: 12px;
}

.value {
  color: #1f2937;
  font-size: 14px;
}

.toolbar {
  display: flex;
  align-items: center;
  padding: 10px 18px 0;
}

.toolbar-label {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.12);
  color: #475569;
  font-size: 12px;
}

.mail-editor {
  flex: 1;
  margin: 14px 18px 18px;
  padding: 18px 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.85);
  outline: none;
  font-size: 15px;
  line-height: 1.8;
  overflow: auto;
  min-height: 280px;
}

.mail-editor:empty::before {
  content: "请输入正文内容...";
  color: #9aa8b8;
}

.composer__footer {
  display: flex;
  justify-content: flex-end;
  padding: 0 18px 16px;
}

.primary-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #0f7cff, #205ee2);
  color: white;
  font-weight: 600;
}

.helper-text {
  margin: 0 18px 18px;
  color: #475569;
  font-size: 12px;
}

.inbox-shell {
  padding: 18px 0 0;
}

.inbox-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.72);
  margin: 0 18px 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  overflow: hidden;
}

.inbox-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(248, 250, 252, 0.8);
}

.toolbar-group {
  display: flex;
  gap: 8px;
}

.toolbar-group--right {
  justify-content: flex-end;
}

.soft-btn {
  padding: 7px 12px;
  background: white;
  border-color: rgba(15, 23, 42, 0.08);
  color: #46536a;
}

.inbox-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.inbox-row {
  display: grid;
  grid-template-columns: 36px minmax(110px, 150px) minmax(0, 1fr) 120px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(255, 255, 255, 0.22);
}

.inbox-row--head {
  background: rgba(241, 245, 249, 0.9);
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.inbox-row.is-unread {
  background: rgba(248, 250, 252, 0.96);
  font-weight: 600;
}

.inbox-check {
  display: flex;
  justify-content: center;
}

.inbox-check input {
  width: 14px;
  height: 14px;
  accent-color: #0f7cff;
}

.inbox-sender,
.inbox-time {
  color: #475569;
  font-size: 12px;
  white-space: nowrap;
}

.inbox-subject {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.inbox-subject strong {
  color: #1f2937;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inbox-subject small {
  color: #64748b;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 960px) {
  .mail-shell {
    flex-direction: column;
  }

  .inbox-row {
    grid-template-columns: 30px minmax(90px, 120px) minmax(0, 1fr) 80px;
    gap: 8px;
    padding: 10px 12px;
  }

  .inbox-subject small {
    display: none;
  }
}
</style>
