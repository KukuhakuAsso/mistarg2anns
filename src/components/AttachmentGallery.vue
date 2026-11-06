<script setup>
// 已提交附件的只读展示（api-8-message-mail.md §8.3）。
//
// 服务端给的 `url` 是受保护路径 `/api/msg/media/<id>`：`<img src>` 直接写会 401，
// 必须带令牌 fetch → blob → objectURL。组件负责加载、失败兜底与卸载时释放 URL；
// 点击缩略图在页内放大（不新开窗口，避免弹窗拦截与令牌泄漏）。
import { onBeforeUnmount, ref, watch } from "vue";
import { fetchMediaBlob } from "@/api/media";
import { formatBytes } from "@/utils/imageUpload";

const props = defineProps({
  // 服务端形状：[{ id, fileName, mimeType, size, url }]
  items: { type: Array, default: () => [] },
});

const entries = ref([]);
const preview = ref(null);
const byKey = new Map();

function keyOf(item) {
  return String(item?.id ?? item?.url ?? item?.fileName ?? "");
}

function revoke(entry) {
  if (entry?.blobUrl && typeof URL !== "undefined") {
    URL.revokeObjectURL(entry.blobUrl);
    entry.blobUrl = "";
  }
}

async function loadInto(entry, rawUrl) {
  if (!rawUrl) {
    entry.loading = false;
    entry.error = "缺少图片地址";
    return;
  }
  try {
    const blob = await fetchMediaBlob(rawUrl);
    if (!entries.value.includes(entry)) return; // 期间被移除，别把 URL 泄漏出去
    entry.blobUrl = URL.createObjectURL(blob);
    entry.error = "";
  } catch (error) {
    entry.error = error?.message || "图片加载失败";
  } finally {
    entry.loading = false;
  }
}

function sync(list) {
  const source = Array.isArray(list) ? list.filter(Boolean) : [];
  const keys = source.map(keyOf);

  for (const [key, entry] of byKey) {
    if (!keys.includes(key)) {
      revoke(entry);
      byKey.delete(key);
    }
  }

  const next = [];
  for (const item of source) {
    const key = keyOf(item);
    let entry = byKey.get(key);
    if (!entry) {
      entries.value.push({
        key,
        fileName: item.fileName || "图片",
        mimeType: item.mimeType || "",
        size: Number(item.size) || 0,
        blobUrl: "",
        loading: true,
        error: "",
      });
      // 取数组里的响应式代理：直接改原始对象不会触发视图更新
      entry = entries.value[entries.value.length - 1];
      byKey.set(key, entry);
      void loadInto(entry, item.url);
    }
    next.push(entry);
  }
  entries.value = next;
  if (preview.value && !next.includes(preview.value)) preview.value = null;
}

watch(() => props.items, sync, { immediate: true, deep: true });

onBeforeUnmount(() => {
  for (const entry of byKey.values()) revoke(entry);
  byKey.clear();
  entries.value = [];
});

function openPreview(entry) {
  if (entry?.blobUrl) preview.value = entry;
}
</script>

<template>
  <div v-if="entries.length" class="gallery">
    <ul class="gallery__list">
      <li v-for="entry in entries" :key="entry.key" class="gallery__item">
        <button
          v-if="entry.blobUrl"
          class="gallery__thumb"
          type="button"
          :title="`${entry.fileName}（点击查看大图）`"
          @click="openPreview(entry)"
        >
          <img :src="entry.blobUrl" :alt="entry.fileName" />
        </button>
        <div v-else class="gallery__thumb is-pending">
          <small>{{ entry.loading ? "加载中…" : entry.error }}</small>
        </div>
        <small class="gallery__name">{{ entry.fileName }}</small>
        <small v-if="entry.size" class="gallery__size">{{ formatBytes(entry.size) }}</small>
      </li>
    </ul>

    <div
      v-if="preview"
      class="gallery__lightbox"
      role="dialog"
      aria-label="图片预览"
      @click.self="preview = null"
    >
      <figure class="gallery__figure">
        <img :src="preview.blobUrl" :alt="preview.fileName" />
        <figcaption>
          {{ preview.fileName }}
          <template v-if="preview.size"> · {{ formatBytes(preview.size) }}</template>
          <button class="gallery__close" type="button" @click="preview = null">关闭</button>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.gallery {
  margin-top: 8px;
}

.gallery__list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gallery__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 108px;
}

.gallery__thumb {
  display: block;
  width: 108px;
  height: 76px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-alt);
  cursor: zoom-in;
}

.gallery__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery__thumb.is-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--text-dim);
  font-size: 10px;
  line-height: 1.4;
  text-align: center;
  cursor: default;
}

.gallery__name {
  overflow: hidden;
  color: var(--text-dim);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery__size {
  color: var(--text-dim);
  font-size: 10px;
}

.gallery__lightbox {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
}

.gallery__figure {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(96vw, 1100px);
  margin: 0;
  color: #f2f2ef;
  font-size: 12px;
}

.gallery__figure img {
  max-width: 100%;
  max-height: 76vh;
  border-radius: 4px;
  background: #000;
}

.gallery__figure figcaption {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gallery__close {
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
