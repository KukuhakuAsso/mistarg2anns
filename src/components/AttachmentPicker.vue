<script setup>
// 图片附件的选择区（api-8-message-mail.md §8.3）。
// 三种入口都支持：按钮选图、Ctrl+V 粘贴、拖拽到输入区（拖拽/粘贴的手柄由父组件绑在包裹元素上，
// 见 useAttachments 的 onPaste / onDragenter / onDrop）。
// 本组件只负责展示与事件上报：上传时序、校验、失败重试都在 useAttachments 里。
import { ref } from "vue";
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_COUNT,
  formatBytes,
} from "@/utils/imageUpload";

const props = defineProps({
  items: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  maxCount: { type: Number, default: IMAGE_MAX_COUNT },
  issue: { type: String, default: "" },
});

const emit = defineEmits(["pick", "remove", "retry"]);

const input = ref(null);

function openPicker() {
  if (props.disabled) return;
  input.value?.click();
}

function onChange(event) {
  const files = event.target?.files;
  if (files && files.length) emit("pick", files);
  // 清空 value，选同一张图也能再次触发 change
  if (event.target) event.target.value = "";
}
</script>

<template>
  <div class="attach">
    <div class="attach__head">
      <button
        class="soft-btn attach__btn"
        type="button"
        :disabled="disabled || items.length >= maxCount"
        @click="openPicker"
      >
        添加图片
      </button>
      <span class="attach__hint">
        可选 {{ maxCount }} 张，JPG / PNG / WebP，单张 ≤5MiB、长边 ≤1600px；
        也可直接粘贴（Ctrl+V）或拖拽图片到文本框
      </span>
      <input
        ref="input"
        class="attach__input"
        type="file"
        :accept="IMAGE_ACCEPT"
        multiple
        :disabled="disabled"
        @change="onChange"
      />
    </div>

    <p v-if="issue" class="attach__issue">{{ issue }}</p>

    <ul v-if="items.length" class="attach__list">
      <li v-for="item in items" :key="item.uid" class="attach__item">
        <div class="attach__thumb">
          <img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.filename" />
          <span v-else class="attach__placeholder">预览不可用</span>

          <div v-if="item.status === 'uploading'" class="attach__progress">
            <span :style="{ width: `${item.progress || 0}%` }"></span>
            <small>{{ item.progress || 0 }}%</small>
          </div>
          <div v-else-if="item.status === 'error'" class="attach__error">
            <small>上传失败</small>
            <button class="attach__mini" type="button" @click="emit('retry', item.uid)">
              重试
            </button>
          </div>
        </div>

        <div class="attach__meta">
          <span class="attach__name" :title="item.filename">{{ item.filename }}</span>
          <small>
            {{ item.width }}×{{ item.height }} · {{ formatBytes(item.sizeBytes) }}
          </small>
          <small v-if="item.status === 'error'" class="attach__error-text">
            {{ item.error }}
          </small>
        </div>

        <button
          class="attach__remove"
          type="button"
          :disabled="disabled"
          title="移除这张图片"
          @click="emit('remove', item.uid)"
        >
          ×
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.attach {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.attach__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.attach__input {
  display: none;
}

.attach__hint {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.attach__issue {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.attach__list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.attach__item {
  position: relative;
  display: flex;
  gap: 8px;
  align-items: center;
  width: min(260px, 100%);
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
}

.attach__thumb {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
}

.attach__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.attach__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-dim);
  font-size: 10px;
}

.attach__progress,
.attach__error {
  position: absolute;
  inset: auto 0 0 0;
  padding: 2px 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
  text-align: center;
}

.attach__progress span {
  display: block;
  height: 2px;
  background: var(--accent);
}

.attach__error {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
}

.attach__mini {
  padding: 0 4px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 10px;
  cursor: pointer;
}

.attach__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 11px;
  color: var(--text-dim);
}

.attach__name {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach__error-text {
  color: var(--danger);
}

.attach__remove {
  position: absolute;
  top: 2px;
  right: 4px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.attach__remove:hover {
  color: var(--danger);
}
</style>
