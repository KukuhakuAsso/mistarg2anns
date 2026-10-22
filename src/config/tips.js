// 题目内的 Tips 弹层内容（占位）。
//
// 注意：这里不是真实提示。真实的求提示走 api-10：
//   提问（POST /api/msg/hint）→ staff 报价 → 玩家确认才扣费 → 答复进队伍会话，
// 入口在站内信的「请求提示」，按次计价、每队同时只能有 1 条待报价。
//
// 本文件只服务于题目弹窗里的「Tips」按钮：三条通用思路提示，按题目标题生成，
// 本地记录解锁状态（不扣 tips 余额），等真正的求提示面板内嵌到题目里之后即可删除。
export function buildPlaceholderTips(title) {
  const name = title || "本题";

  return [
    `Tips 1：重新阅读「${name}」的题面，注意其中重复出现的信息。`,
    "Tips 2：先整理可直接观察到的元素，再尝试建立它们之间的关联。",
    "Tips 3：当常规阅读没有进展时，检查格式、顺序和隐藏的结构。",
  ];
}

export default buildPlaceholderTips;
