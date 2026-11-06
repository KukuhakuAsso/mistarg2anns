<script setup>
// 单个附件：按 type 选择原生标签，素材统一走带鉴权的 blob URL。
import { computed } from "vue";
import { useMediaObjectUrl } from "@/composables/useMediaObjectUrl";

const props = defineProps({
  item: { type: Object, required: true },
});

const isLink = computed(() => props.item?.type === "link");
const mediaPath = computed(() => (isLink.value ? "" : props.item?.url ?? ""));
const { src, status, error, reload } = useMediaObjectUrl(mediaPath);

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(value) {
  const total = Number(value);
  if (!Number.isFinite(total) || total <= 0) return "";
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const sizeText = computed(() => formatBytes(props.item?.sizeBytes));
const durationText = computed(() => formatDuration(props.item?.durationSec));
</script>

<template>
  <li class="attachment">
    <!-- 外链附件由出题人直接给 https 地址，不经过素材接口 -->
    <template v-if="isLink">
      <a
        class="attachment__link"
        :href="item.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ item.name }}
      </a>
      <span v-if="item.note" class="attachment__note">{{ item.note }}</span>
    </template>

    <template v-else-if="status === 'ready'">
      <figure v-if="item.type === 'image'" class="attachment__image">
        <a :href="src" target="_blank" rel="noopener noreferrer">
          <img :src="src" :alt="item.name" loading="lazy" />
        </a>
        <figcaption>{{ item.name }}</figcaption>
      </figure>

      <div v-else-if="item.type === 'video'" class="attachment__media">
        <span class="attachment__name">{{ item.name }}</span>
        <video :src="src" controls preload="metadata" />
      </div>

      <div v-else-if="item.type === 'audio'" class="attachment__media">
        <span class="attachment__name">
          {{ item.name }}
          <span v-if="durationText" class="attachment__meta">· {{ durationText }}</span>
        </span>
        <audio :src="src" controls preload="metadata" />
      </div>

      <a v-else class="attachment__file" :href="src" :download="item.name">
        <span class="attachment__name">{{ item.name }}</span>
        <span v-if="sizeText" class="attachment__meta">{{ sizeText }}</span>
      </a>

      <span v-if="item.note" class="attachment__note">{{ item.note }}</span>
    </template>

    <div v-else-if="status === 'error'" class="attachment__fallback">
      <span>{{ item.name }}：{{ error }}</span>
      <button type="button" class="attachment__retry" @click="reload">
        重试
      </button>
    </div>

    <div v-else class="attachment__loading">{{ item.name }} 加载中…</div>
  </li>
</template>

<style scoped>
.attachment {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attachment__link,
.attachment__file {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
}

.attachment__link:hover,
.attachment__file:hover {
  text-decoration: underline;
}

.attachment__name {
  font-size: 13px;
  color: var(--text);
}

.attachment__meta,
.attachment__note,
.attachment__loading {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

.attachment__image {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attachment__image img {
  display: block;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.attachment__image figcaption {
  font-size: 12px;
  color: var(--text-dim);
}

.attachment__media {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attachment__media video,
.attachment__media audio {
  width: 100%;
  border-radius: var(--radius);
}

.attachment__fallback {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-dim);
}

.attachment__retry {
  padding: 2px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  font-size: 11px;
  color: var(--text);
  cursor: pointer;
}
</style>
