<template>
  <div class="app">
    <GalPage />
  </div>
</template>

<script setup>
import GalPage from "./components/GalPage.vue";
</script>

<style scoped>
/* 页面即游戏宿主：布局由全局 style.css 的 .app 控制，
   引擎工具条/舞台样式在 GalPage.vue 内维护 */
</style>
