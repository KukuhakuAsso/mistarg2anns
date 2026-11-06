<script setup>
// 可塑区容器：只负责对齐、最小高度、纸面底、骨架与错误兜底；
// 组件内部的排版由组件自己负责（组件包内联了自己的 Vue 运行时）。
import { computed, h, onBeforeUnmount, watch } from "vue";
import { useMalleableWidget } from "@/composables/useMalleableWidget";

const props = defineProps({
  malleable: { type: Object, required: true },
});

const isComponent = computed(() => props.malleable?.kind === "component");
const isIframe = computed(() => props.malleable?.kind === "iframe");

// 骨架与容器同高，避免组件挂载时页面跳动（CLS = 0）。
const minHeight = computed(() => {
  const value = Number(props.malleable?.minHeight);
  return Number.isFinite(value) && value > 0 ? value : 320;
});

const widgetProps = computed(() => props.malleable?.props ?? {});
const asset = computed(() => props.malleable?.asset ?? null);

// 用 render 函数挂自定义元素：props 走 DOM property 而不是 attribute，
// 这样出题人配置的对象/回调不会在跨边界时被序列化成字符串。
const WidgetHost = {
  props: {
    tag: { type: String, required: true },
    widgetProps: { type: Object, default: () => ({}) },
  },
  setup(hostProps) {
    return () => h(hostProps.tag, { ...hostProps.widgetProps });
  },
};

const { status, error, tag, ensure, cancel } = useMalleableWidget();

watch(
  asset,
  (value) => {
    // asset 为 null（组件已停用等异常）也交给 ensure 处理，显示区内 fallback 而不是一直骨架
    if (isComponent.value) ensure(value ?? null);
  },
  { immediate: true },
);

onBeforeUnmount(cancel);

function retry() {
  ensure(asset.value ?? null);
}
</script>

<template>
  <figure class="malleable" :class="{ 'malleable--wide': malleable.wide }">
    <div class="malleable__frame" :style="{ minHeight: `${minHeight}px` }">
      <template v-if="isComponent">
        <WidgetHost
          v-if="status === 'ready'"
          :tag="tag"
          :widget-props="widgetProps"
          class="malleable__host"
        />
        <div v-else-if="status === 'error'" class="malleable__fallback">
          <p>{{ error || "可塑区组件加载失败" }}</p>
          <button class="malleable__retry" type="button" @click="retry">
            重试
          </button>
        </div>
        <div v-else class="malleable__skeleton" aria-hidden="true" />
      </template>

      <iframe
        v-else-if="isIframe"
        class="malleable__iframe"
        :src="malleable.url"
        :style="{ minHeight: `${minHeight}px` }"
        loading="lazy"
        referrerpolicy="no-referrer"
        allow="fullscreen"
      />

      <div v-else class="malleable__fallback">
        <p>{{ malleable.name || "本题没有可交互区域" }}</p>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.malleable {
  margin: 0;
  display: flex;
  justify-content: center;
}

.malleable__frame {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--surface) 92%, var(--bg));
}

.malleable--wide .malleable__frame {
  width: 100%;
}

.malleable__host {
  display: block;
  width: 100%;
}

.malleable__iframe {
  width: 100%;
  flex: 1;
  border: 0;
  border-radius: calc(var(--radius) - 4px);
  background: var(--bg);
}

.malleable__skeleton {
  flex: 1;
  border-radius: calc(var(--radius) - 4px);
  background: repeating-linear-gradient(
    90deg,
    color-mix(in srgb, var(--border) 40%, transparent) 0 2px,
    transparent 2px 12px
  );
  animation: malleable-pulse 1.6s ease-in-out infinite;
}

@keyframes malleable-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.85;
  }
}

.malleable__fallback {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  border: 1px dashed var(--border);
  border-radius: calc(var(--radius) - 4px);
  font-size: 13px;
  color: var(--text-dim);
  text-align: center;
}

.malleable__fallback p {
  margin: 0;
}

.malleable__retry {
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.malleable__retry:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
