export const ARCHIVE_DATABASE = [
  {
    id: "ARC-001",
    name: "档案 01 · 起点",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "记录起始信件与地图残片，标记进入调查的初始线索。",
    updatedAt: "2026-04-08 09:15",
  },
  {
    id: "ARC-002",
    name: "档案 02 · 频率",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "记录电波频段与摩尔斯片段，发现时间与空间的隐性关联。",
    updatedAt: "2026-04-08 10:12",
  },
  {
    id: "ARC-003",
    name: "档案 03 · 图像",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "包含图种文件与图像通道分析，指向异常的视觉信息编码。",
    updatedAt: "2026-04-08 11:28",
  },
  {
    id: "ARC-004",
    name: "档案 04 · 声纹",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "分析声纹与采样率异常，推断出潜在的第三方干预信号。",
    updatedAt: "2026-04-08 12:40",
  },
  {
    id: "ARC-005",
    name: "档案 05 · 时间",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "跨越时间线的五封长信，揭示事件发生的时序错位。",
    updatedAt: "2026-04-08 13:50",
  },
  {
    id: "ARC-006",
    name: "档案 06 · 密钥",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "密钥片段与加密日志为后续终端访问提供唯一入口。",
    updatedAt: "2026-04-08 15:05",
  },
  {
    id: "ARC-007",
    name: "档案 07 · 终端",
    category: "主线",
    status: "已归档",
    owner: "星图调查组",
    summary: "终端回显与进程清单，提供最终登录动作的关键证据。",
    updatedAt: "2026-04-08 16:20",
  },
  {
    id: "ARC-008",
    name: "未归档记录",
    category: "隐藏",
    status: "待解锁",
    owner: "档案管理员",
    summary: "隐藏档案，需在主线全部完成后方可解锁并检索。",
    updatedAt: "2026-04-08 18:00",
  },
];

export function searchArchiveById(searchText) {
  const query = String(searchText || "").trim().toUpperCase();
  if (!query) return [];

  return ARCHIVE_DATABASE.filter((record) => {
    const haystack = `${record.id} ${record.name} ${record.category}`.toUpperCase();
    return haystack.includes(query);
  });
}
