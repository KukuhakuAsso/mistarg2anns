<script setup>
// 题目封面/缩略图：题目入口按钮、线索栏卡片与拖动浮层共用。
//
// map 里的 cover 已按本队进度挑好（未解 = 主封面，已解且配了完成态封面 = 完成态封面），
// 前端只管显示，不用再判断 solved 换图。
// cover.url 是受保护素材（要 Authorization），原生 <img src> 带不上请求头，
// 所以统一走 blob；未配置或加载失败时回退本地占位图。
import puzzleThumbnail from "@/assets/test.jpg";
import { useMediaObjectUrl } from "@/composables/useMediaObjectUrl";

const props = defineProps({
  cover: { type: Object, default: null },
  // 卡片场景用卡片标题更贴切；不给时退回封面自带的 alt
  alt: { type: String, default: "" },
});

const { src } = useMediaObjectUrl(() => props.cover?.url ?? "");
</script>

<template>
  <img :src="src || puzzleThumbnail" :alt="alt || cover?.alt || ''" />
</template>
