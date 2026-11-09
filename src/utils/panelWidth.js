// 线索栏宽度（拖动左侧把手调整）的取值规则。
//
// 线索栏固定在右侧，所以「往左拖 = 变宽」。宽度要同时受三件事约束：
//   * 自身可读性：卡片宽 156px，太窄放不下一列
//   * 主内容区：窗口再窄也不能让线索栏把内容挤没
//   * 上限：留出余量，避免整屏只剩线索栏
export const CLUE_PANEL_MIN_W = 280;
export const CLUE_PANEL_MAX_W = 760;
export const CLUE_PANEL_MIN_CONTENT = 320;

// 把任意输入收拢到合法区间。viewportWidth 取 window.innerWidth。
// 注意 min/max 都要按视口算，且保证 min <= max（极窄窗口下优先保住 min）。
export function clampCluePanelWidth(value, viewportWidth) {
    const viewport =
        Number.isFinite(viewportWidth) && viewportWidth > 0
            ? viewportWidth
            : CLUE_PANEL_MIN_W + CLUE_PANEL_MIN_CONTENT;

    const max = Math.min(
        CLUE_PANEL_MAX_W,
        Math.max(CLUE_PANEL_MIN_W, viewport - CLUE_PANEL_MIN_CONTENT),
    );
    const min = Math.min(CLUE_PANEL_MIN_W, max);

    const num = Number(value);
    if (!Number.isFinite(num)) return min;

    return Math.round(Math.min(Math.max(num, min), max));
}
