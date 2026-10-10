<script setup>
import { computed, ref } from "vue";
import { useGameState } from "@/composables/useGameState";

const { state } = useGameState();
const activeTab = ref("inbox");
const inboxFilter = ref("all");
const mailEditor = ref(null);
const messageNotice = ref("");

const recipientLabel = state.user.currentUser
  ? state.user.currentUser.username
  : "管理员";

const inboxItems = ref([
  {
    id: 1,
    sender: "Copilot",
    subject: "Re: KukuhakuAsso/mistarg2anns feature/blackboard",
    preview: "Completed the team page flow and adjusted the desktop menu behavior for archive fallback.",
    time: "2025-03-28 10:26",
    unread: true,
    starred: false,
    content:
      "Hi there,\n\nThanks for the recent updates to the desktop layout and team flow. I reviewed the archive fallback fix and the team page flow again. The current milestone is now aligned with the requested page routing, and the menu behavior is anchored to the clicked app button instead of floating in the center of the screen.\n\nPlease continue refining the message view so the mail detail experience matches the project’s desktop UI style more closely.\n\nBest,\nCopilot",
  },
  {
    id: 2,
    sender: "GitHub",
    subject: "Pull request update",
    preview: "Your review was requested on a recent pull request for the message page refinement.",
    time: "2025-03-27 18:40",
    unread: false,
    starred: false,
    content:
      "A pull request has been updated and a review was requested.\n\nThe branch includes refinements to the inbox view and filtering behavior, plus a few UI adjustments for the desktop prototype. Please review the current changes and leave feedback if any interaction or layout adjustments are still needed.\n\nThanks,\nGitHub",
  },
  {
    id: 3,
    sender: "CloudDNS",
    subject: "Domain verification reminder",
    preview: "A new DNS validation request was generated for your project. Please review the records.",
    time: "2025-03-26 11:05",
    unread: true,
    starred: true,
    content:
      "This is a reminder that your DNS verification record needs review.\n\nA new validation request was generated for your domain, and the current status is waiting for a final check. Please confirm the values match the expected project configuration.\n\nRegards,\nCloudDNS",
  },
  {
    id: 4,
    sender: "Google",
    subject: "Security alert",
    preview: "A new sign-in was detected on your account from an unrecognized device.",
    time: "2025-03-25 09:18",
    unread: false,
    starred: false,
    content:
      "We detected a sign-in attempt from a new device or browser.\n\nIf this was not you, please review your account activity and update your recovery settings immediately. If this was you, no action is required.\n\nSecurity Team\nGoogle",
  },
]);
const selectedMessageIds = ref([]);
const selectedMessageId = ref(null);

const filteredInboxItems = computed(() => {
  if (inboxFilter.value === "read") {
    return inboxItems.value.filter((item) => !item.unread);
  }

  if (inboxFilter.value === "unread") {
    return inboxItems.value.filter((item) => item.unread);
  }

  return inboxItems.value;
});

const allVisibleSelected = computed(() => {
  if (!filteredInboxItems.value.length) {
    return false;
  }

  return filteredInboxItems.value.every((item) => selectedMessageIds.value.includes(item.id));
});

const selectedMessage = computed(() =>
  inboxItems.value.find((item) => item.id === selectedMessageId.value) ?? null,
);

function switchTab(tab) {
  activeTab.value = tab;
  messageNotice.value = "";
}

function setInboxFilter(filter) {
  inboxFilter.value = filter;
}

function openMessage(messageId) {
  const target = inboxItems.value.find((item) => item.id === messageId);
  if (!target) {
    return;
  }

  markMessageRead(messageId);
  selectedMessageId.value = messageId;
}

function closeMessageDetail() {
  selectedMessageId.value = null;
}

function markMessageRead(messageId) {
  const target = inboxItems.value.find((item) => item.id === messageId);
  if (target) {
    target.unread = false;
  }
}

function toggleSelectMessage(messageId) {
  if (selectedMessageIds.value.includes(messageId)) {
    selectedMessageIds.value = selectedMessageIds.value.filter((id) => id !== messageId);
    return;
  }

  selectedMessageIds.value = [...selectedMessageIds.value, messageId];
}

function toggleSelectAllVisible() {
  if (allVisibleSelected.value) {
    selectedMessageIds.value = selectedMessageIds.value.filter(
      (id) => !filteredInboxItems.value.some((item) => item.id === id),
    );
    return;
  }

  const visibleIds = filteredInboxItems.value.map((item) => item.id);
  selectedMessageIds.value = Array.from(new Set([...selectedMessageIds.value, ...visibleIds]));
}

function deleteMessage(messageId) {
  const target = inboxItems.value.find((item) => item.id === messageId);
  if (!target) {
    return;
  }

  const confirmed = window.confirm(`确定删除来自“${target.sender}”的邮件吗？`);
  if (!confirmed) {
    return;
  }

  inboxItems.value = inboxItems.value.filter((item) => item.id !== messageId);
  selectedMessageIds.value = selectedMessageIds.value.filter((id) => id !== messageId);
}

function deleteSelectedMessages() {
  if (!selectedMessageIds.value.length) {
    return;
  }

  const confirmed = window.confirm(`确定删除选中的 ${selectedMessageIds.value.length} 封邮件吗？`);
  if (!confirmed) {
    return;
  }

  inboxItems.value = inboxItems.value.filter((item) => !selectedMessageIds.value.includes(item.id));
  selectedMessageIds.value = [];
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
        <template v-if="selectedMessage">
          <header class="message-detail-header">
            <button class="soft-btn" type="button" @click="closeMessageDetail">返回收件箱</button>
            <button class="soft-btn danger-btn" type="button" @click.stop="deleteMessage(selectedMessage.id)">
              删除
            </button>
          </header>

          <article class="message-detail">
            <header class="message-detail__header">
              <div class="message-detail__meta">
                <span class="detail-label">发件人</span>
                <strong>{{ selectedMessage.sender }}</strong>
              </div>
              <div class="message-detail__meta">
                <span class="detail-label">时间</span>
                <span>{{ selectedMessage.time }}</span>
              </div>
            </header>

            <h2 class="message-detail__subject">{{ selectedMessage.subject }}</h2>

            <div class="message-detail__body">
              <p v-for="(paragraph, index) in selectedMessage.content.split('\n\n')" :key="index">
                {{ paragraph.replace(/\n/g, " ") }}
              </p>
            </div>
          </article>
        </template>

        <template v-else>
          <header class="inbox-toolbar">
            <div class="toolbar-group">
              <button
                :class="['soft-btn', { 'is-selected': inboxFilter === 'all' }]"
                type="button"
                @click="setInboxFilter('all')"
              >
                全部
              </button>
              <button
                :class="['soft-btn', { 'is-selected': inboxFilter === 'unread' }]"
                type="button"
                @click="setInboxFilter('unread')"
              >
                未读
              </button>
              <button
                :class="['soft-btn', { 'is-selected': inboxFilter === 'read' }]"
                type="button"
                @click="setInboxFilter('read')"
              >
                已读
              </button>
            </div>
            <div class="toolbar-group toolbar-group--right">
              <button
                class="soft-btn danger-btn"
                type="button"
                :disabled="!selectedMessageIds.length"
                @click="deleteSelectedMessages"
              >
                批量删除
              </button>
              <button class="soft-btn" type="button">刷新</button>
            </div>
          </header>

          <div class="inbox-list">
            <div class="inbox-row inbox-row--head">
              <span class="inbox-check">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  :indeterminate="selectedMessageIds.length > 0 && !allVisibleSelected"
                  @change="toggleSelectAllVisible"
                />
              </span>
              <span class="inbox-sender">发件人</span>
              <span class="inbox-subject">主题</span>
              <span class="inbox-time">时间</span>
              <span class="inbox-actions">操作</span>
            </div>

            <div
              v-for="item in filteredInboxItems"
              :key="item.id"
              :class="['inbox-row', { 'is-unread': item.unread }]"
              @click="openMessage(item.id)"
            >
              <span class="inbox-check">
                <input
                  type="checkbox"
                  :checked="selectedMessageIds.includes(item.id)"
                  @click.stop
                  @change="toggleSelectMessage(item.id)"
                />
              </span>
              <span class="inbox-sender">{{ item.sender }}</span>
              <span class="inbox-subject">
                <strong>{{ item.subject }}</strong>
                <small>{{ item.preview }}</small>
              </span>
              <span class="inbox-time">{{ item.time }}</span>
              <span class="inbox-actions">
                <button class="delete-btn" type="button" @click.stop="deleteMessage(item.id)">
                  删除
                </button>
              </span>
            </div>
          </div>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg);
}

.mail-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--text);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
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
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--surface-alt);
  font-size: 12px;
  color: var(--text-dim);
}

.mini-btn {
  padding: 7px 12px;
  background: var(--surface);
  border-color: var(--border);
}

.mail-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--bg);
}

.compose-shell {
  padding: 0;
}

.composer {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
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
  color: var(--text-dim);
  font-size: 12px;
}

.value {
  color: var(--text);
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
  background: var(--surface-alt);
  color: var(--text-dim);
  font-size: 12px;
}

.mail-editor {
  flex: 1;
  margin: 14px 18px 18px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  outline: none;
  font-size: 15px;
  line-height: 1.8;
  overflow: auto;
  min-height: 280px;
}

.mail-editor:empty::before {
  content: "请输入正文内容...";
  color: var(--text-dim);
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
  color: var(--text-dim);
  font-size: 12px;
}

.inbox-shell {
  padding: 18px 0 0;
}

.inbox-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  margin: 0 18px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.inbox-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 85%, transparent);
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
  background: var(--surface);
  border-color: var(--border);
  color: var(--text-dim);
}

.soft-btn.is-selected {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent);
}

.soft-btn.danger-btn {
  background: color-mix(in srgb, var(--danger) 14%, var(--surface));
  border-color: color-mix(in srgb, var(--danger) 20%, transparent);
  color: var(--danger);
}

.soft-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.inbox-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.inbox-row {
  display: grid;
  grid-template-columns: 36px minmax(110px, 150px) minmax(0, 1fr) 120px 80px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
}

.inbox-row--head {
  background: color-mix(in srgb, var(--surface-alt) 92%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}

.inbox-row.is-unread {
  background: color-mix(in srgb, var(--surface) 88%, transparent);
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
.inbox-time,
.inbox-actions {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}

.inbox-actions {
  display: flex;
  justify-content: flex-end;
}

.delete-btn {
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
  color: var(--danger);
  font-size: 11px;
  cursor: pointer;
}

.delete-btn:hover {
  background: color-mix(in srgb, var(--danger) 18%, var(--surface));
}

.inbox-subject {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.inbox-subject strong {
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inbox-subject small {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-alt) 88%, transparent);
}

.message-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 20px 24px 24px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
  min-height: 0;
  overflow: auto;
}

.message-detail__header {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.message-detail__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

.detail-label {
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.message-detail__subject {
  margin: 18px 0 16px;
  font-size: 26px;
  line-height: 1.3;
  color: var(--text);
}

.message-detail__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--text);
  font-size: 15px;
  line-height: 1.9;
}

.message-detail__body p {
  margin: 0;
  white-space: pre-wrap;
}

@media (max-width: 960px) {
  .mail-shell {
    flex-direction: column;
  }

  .inbox-row {
    grid-template-columns: 30px minmax(90px, 120px) minmax(0, 1fr) 80px 68px;
    gap: 8px;
    padding: 10px 12px;
  }

  .inbox-subject small {
    display: none;
  }
}
</style>
