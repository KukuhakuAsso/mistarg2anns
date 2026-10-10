<script setup>
// 通讯视图组件
import { computed, ref } from "vue";

const conversations = [
  {
    id: "group-ops",
    name: "星图调查组",
    status: "在线",
    avatar: "ST",
    unread: 3,
    lastMessage: "终端回显里出现了重复的时间戳，正在核对日志。",
    lastTime: "09:42",
    messages: [
      { id: 1, author: "Alice", me: false, text: "终端回显里出现了重复的时间戳，你看到了吗？", time: "09:18" },
      { id: 2, author: "我", me: true, text: "我看到了一些异常值，应该和时区偏差有关。", time: "09:21" },
      { id: 3, author: "Bob", me: false, text: "我正在核对密钥片段和日志，确认是不是同一条链路。", time: "09:34" },
      { id: 4, author: "我", me: true, text: "继续追踪终端回显，重点看最后一次登录。", time: "09:42" },
    ],
  },
  {
    id: "support",
    name: "技术支持",
    status: "在线",
    avatar: "TS",
    unread: 0,
    lastMessage: "档案数据库搜索功能已经接入测试环境。",
    lastTime: "昨天",
    messages: [
      { id: 1, author: "技术支持", me: false, text: "档案数据库搜索功能已经接入测试环境。", time: "昨天" },
      { id: 2, author: "我", me: true, text: "收到，接下来我会继续补充结果页样式。", time: "昨天" },
    ],
  },
  {
    id: "ops-1",
    name: "档案管理员",
    status: "忙碌",
    avatar: "AM",
    unread: 1,
    lastMessage: "未归档记录现在可以按 ID 检索。",
    lastTime: "周一",
    messages: [
      { id: 1, author: "档案管理员", me: false, text: "未归档记录现在可以按 ID 检索。", time: "周一" },
      { id: 2, author: "我", me: true, text: "好的，我接着补充过滤和提示说明。", time: "周一" },
    ],
  },
  {
    id: "friend-1",
    name: "Alice",
    status: "离线",
    avatar: "AL",
    unread: 0,
    lastMessage: "你这次的档案流程已经跑通了，继续加油。",
    lastTime: "周日",
    messages: [
      { id: 1, author: "Alice", me: false, text: "你这次的档案流程已经跑通了，继续加油。", time: "周日" },
    ],
  },
];

const selectedId = ref(conversations[0].id);
const draft = ref("");

const activeConversation = computed(() =>
  conversations.find((conversation) => conversation.id === selectedId.value) ?? conversations[0],
);

function selectConversation(id) {
  selectedId.value = id;
}

function sendMessage() {
  const content = draft.value.trim();
  if (!content) return;

  const current = activeConversation.value;
  current.messages.push({
    id: Date.now(),
    author: "我",
    me: true,
    text: content,
    time: "刚刚",
  });
  current.lastMessage = content;
  current.lastTime = "刚刚";
  draft.value = "";
}
</script>

<template>
  <section class="communication-app">
    <header class="communication-app__header">
      <div class="communication-app__brand">
        <p class="eyebrow">通讯</p>
        <h1>消息中心</h1>
      </div>
    </header>

    <div class="communication-app__body">
      <aside class="conversation-list">
        <div class="conversation-list__head">
          <span>聊天</span>
          <button type="button" class="tiny-button">+</button>
        </div>

        <ul>
          <li
            v-for="conversation in conversations"
            :key="conversation.id"
            :class="['conversation-item', { 'is-active': conversation.id === selectedId }]"
            @click="selectConversation(conversation.id)"
          >
            <div class="conversation-item__avatar">{{ conversation.avatar }}</div>
            <div class="conversation-item__content">
              <div class="conversation-item__row">
                <strong>{{ conversation.name }}</strong>
                <time>{{ conversation.lastTime }}</time>
              </div>
              <div class="conversation-item__row conversation-item__row--meta">
                <span>{{ conversation.lastMessage }}</span>
                <em v-if="conversation.unread" class="badge">{{ conversation.unread }}</em>
              </div>
            </div>
          </li>
        </ul>
      </aside>

      <main class="chat-panel">
        <header class="chat-panel__header">
          <div class="chat-panel__user">
            <div class="conversation-item__avatar conversation-item__avatar--large">
              {{ activeConversation.avatar }}
            </div>
            <div>
              <h2>{{ activeConversation.name }}</h2>
              <small>{{ activeConversation.status }}</small>
            </div>
          </div>
          <div class="chat-panel__actions">
            <button type="button" class="tiny-button">电话</button>
            <button type="button" class="tiny-button">视频</button>
          </div>
        </header>

        <section class="chat-panel__messages">
          <div
            v-for="message in activeConversation.messages"
            :key="message.id"
            :class="['message-row', message.me ? 'message-row--self' : 'message-row--peer']"
          >
            <div v-if="!message.me" class="message-row__avatar">{{ activeConversation.avatar }}</div>
            <div class="message-bubble">
              <span class="message-bubble__meta">{{ message.author }}</span>
              <p>{{ message.text }}</p>
              <time>{{ message.time }}</time>
            </div>
          </div>
        </section>

        <footer class="chat-panel__composer">
          <div class="composer-tools">
            <button type="button" class="tiny-button">+ </button>
          </div>
          <input
            v-model="draft"
            type="text"
            placeholder="输入消息..."
            @keydown.enter="sendMessage"
            disabled
          />
          <button class="primary-button" type="button" @click="sendMessage">发送</button>
        </footer>
      </main>
    </div>
  </section>
</template>

<style scoped>
.communication-app {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  min-height: 0;
}

.communication-app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.communication-app__brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.communication-app__brand h1 {
  margin: 0;
  font-size: 28px;
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.communication-app__body {
  display: flex;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 20px;
  overflow: hidden;
  background: var(--surface);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
}

.conversation-list {
  width: 340px;
  border-right: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
}

.conversation-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px 12px;
  font-weight: 700;
  border-bottom: 1px solid var(--border);
}

.conversation-list ul {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conversation-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 10px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.conversation-item:hover,
.conversation-item.is-active {
  background: rgba(113, 160, 255, 0.12);
}

.conversation-item__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(108, 124, 255, 0.9), rgba(116, 220, 255, 0.7));
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;
}

.conversation-item__avatar--large {
  width: 44px;
  height: 44px;
  border-radius: 16px;
}

.conversation-item__content {
  flex: 1;
  min-width: 0;
}

.conversation-item__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.conversation-item__row strong {
  font-size: 14px;
  color: var(--text);
}

.conversation-item__row time,
.conversation-item__row span {
  color: var(--text-dim);
  font-size: 12px;
}

.conversation-item__row--meta {
  margin-top: 6px;
}

.conversation-item__row--meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #ff5f5f;
  color: white;
  font-style: normal;
  font-size: 11px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: rgba(17, 22, 31, 0.1);
}

.chat-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
}

.chat-panel__user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-panel__user h2 {
  margin: 0;
  font-size: 20px;
}

.chat-panel__user small {
  color: var(--text-dim);
}

.chat-panel__actions {
  display: flex;
  gap: 8px;
}

.tiny-button,
.ghost-button {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  padding: 7px 11px;
  cursor: pointer;
}

.chat-panel__messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  padding: 22px;
  overflow-y: auto;
}

.message-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.message-row--self {
  justify-content: flex-end;
}

.message-row__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(129, 149, 255, 0.85), rgba(80, 190, 255, 0.7));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.message-bubble {
  max-width: min(72%, 460px);
  padding: 12px 14px 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
}

.message-row--self .message-bubble {
  background: linear-gradient(135deg, rgba(94, 117, 255, 0.36), rgba(75, 191, 214, 0.2));
}

.message-bubble__meta {
  display: block;
  margin-bottom: 6px;
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.message-bubble p {
  margin: 0;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}

.message-bubble time {
  display: block;
  margin-top: 8px;
  color: var(--text-dim);
  font-size: 11px;
  text-align: right;
}

.chat-panel__composer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 18px;
  border-top: 1px solid var(--border);
}

.composer-tools {
  display: flex;
  gap: 8px;
}

.chat-panel__composer input {
  flex: 1;
  min-height: 46px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  padding: 0 14px;
}

.primary-button {
  border: 1px solid rgba(112, 160, 255, 0.6);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(80, 127, 255, 0.24), rgba(136, 92, 246, 0.2));
  color: var(--text);
  padding: 10px 16px;
  cursor: pointer;
}
</style>
