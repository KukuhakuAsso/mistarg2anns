// 线索卡片的排版尺寸（唯一来源）。
// 板面坐标系、拖拽落点换算与自动排列共用这组常量；
// main.js 启动时把 CARD_W / CARD_H 写进 CSS 变量 --card-w / --card-h，ClueCard.vue 用它渲染。

export const CARD_W = 156;
export const CARD_H = 88;
export const CARD_GAP = 10;
