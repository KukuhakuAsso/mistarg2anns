// 邮件列表行的入场序号编号规则（配合 MessageView 的 mail-slide-in 动画）。
//
// 为什么单独抽出来：后端没有「分类 tab」参数，「已读」与「来源」只能在前端分类。
// 若照接口返回的原始顺序编号，一页 20 封里只有 3 封符合条件时，
// 挂载出来的行会拿到被打散的序号（0 / 7 / 13），animation-delay 就出现空洞，
// 看起来像「先挂载再被筛掉」。正确顺序是：先筛出要显示的行 → 按显示顺序连续编号 → 再挂载。
//
// 返回一张新 Map（mailId → 序号）：调用方直接整体替换，避免原地改动影响响应式追踪。
//
// @param {Map<string, number>|null|undefined} prevMap 已有编号（翻页追加时沿用旧行节奏）
// @param {Array<object>} items 本次接口返回的行
// @param {(item: object) => boolean} isVisible 该行是否会被渲染（即与渲染用同一套筛选规则）
export function assignEnterIndex(prevMap, items, isVisible) {
  const next = new Map(prevMap ?? []);
  let shown = 0;

  for (const item of items ?? []) {
    if (!isVisible(item)) continue;
    next.set(item.mailId, shown);
    shown += 1;
  }

  return next;
}
