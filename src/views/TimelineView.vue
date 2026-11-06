<script setup>
import { defineEmits } from "vue";

const emit = defineEmits(["close"]);

const timelineNodes = [
  {
    id: "t-01",
    side: "left",
    time: "04-08 09:15",
    title: "首封信件到达",
    description: "调查组收到来自未知来源的第一封信，时间与邮戳相互印证。",
  },
  {
    id: "t-02",
    side: "right",
    time: "04-08 10:12",
    title: "电波异常",
    description: "在低频段中检测到重复信号，说明事件并非纯偶然。",
  },
  {
    id: "t-03",
    side: "left",
    time: "04-08 11:28",
    title: "图像异变",
    description: "图种文件中出现被覆盖的通道信息，像素排列方式明显异常。",
  },
  {
    id: "t-04",
    side: "right",
    time: "04-08 12:40",
    title: "声纹复现",
    description: "采样率偏差逐步锁定到同一音频来源，形成关键证据链。",
  },
  {
    id: "t-05",
    side: "left",
    time: "04-08 13:50",
    title: "时间错位",
    description: "五封长信的时间线开始出现站错位现象，案件主线被重新排序。",
  },
  {
    id: "t-06",
    side: "right",
    time: "04-08 15:05",
    title: "密钥破译",
    description: "密钥片段拼接后，终端可访问权限被重新激活。",
  },
  {
    id: "t-07",
    side: "left",
    time: "04-08 16:20",
    title: "终端登录",
    description: "最后一次登录记录显示事件准备完成，调查组接近揭示真相。",
  },
];
</script>

<template>
  <section class="timeline-app">
    <header class="timeline-app__header">
      <div class="timeline-app__title">
        <p class="eyebrow">工具</p>
        <h1>时间线</h1>
      </div>
      <button class="ghost-button" type="button" @click="emit('close')">返回桌面</button>
    </header>

    <div class="panel-card">
      <header class="panel-card__head">
        <h2>解密时间线</h2>
        <span>中心线索 · 双侧事件</span>
      </header>

      <div class="timeline" aria-label="解密剧情时间线">
        <div class="timeline__axis"></div>

        <div
          v-for="node in timelineNodes"
          :key="node.id"
          :class="['timeline-node', `timeline-node--${node.side}`]"
        >
          <div class="timeline-node__dot"></div>
          <article class="timeline-node__card">
            <time>{{ node.time }}</time>
            <h3>{{ node.title }}</h3>
            <p>{{ node.description }}</p>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline-app {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.timeline-app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.timeline-app__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-app__title h1 {
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

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.panel-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-card__head h2 {
  margin: 0;
  font-size: 20px;
}

.panel-card__head span {
  color: var(--text-dim);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 600px;
  padding: 20px 12px 8px;
}

.timeline__axis {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 3px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(123, 176, 255, 0.7), rgba(122, 111, 255, 0.5));
}

.timeline-node {
  position: relative;
  display: flex;
  width: 50%;
  align-items: center;
}

.timeline-node--left {
  justify-content: flex-start;
  padding-right: 24px;
}

.timeline-node--right {
  justify-content: flex-end;
  padding-left: 24px;
  margin-left: 50%;
}

.timeline-node__dot {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(118, 147, 255, 1), rgba(144, 214, 255, 1));
  box-shadow: 0 0 0 6px rgba(118, 147, 255, 0.12);
  transform: translateY(-50%);
}

.timeline-node--left .timeline-node__dot {
  right: -8px;
}

.timeline-node--right .timeline-node__dot {
  left: -8px;
}

.timeline-node__card {
  width: min(100%, 310px);
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.08);
}

.timeline-node__card time {
  display: block;
  margin-bottom: 8px;
  color: var(--text-dim);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.timeline-node__card h3 {
  margin: 0 0 8px;
  font-size: 18px;
}

.timeline-node__card p {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.7;
}

.ghost-button {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
}
</style>
