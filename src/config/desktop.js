export const DESKTOP_APPS = [
  {
    id: "user",
    name: "用户",
    icon: "user",
    description: "个人状态与设定",
    accent: "cyan",
  },
  {
    id: "archive",
    name: "档案",
    icon: "folder",
    description: "主线与隐藏记录",
    accent: "amber",
  },
  {
    id: "entertainment",
    name: "娱乐",
    icon: "monitor",
    description: "休闲行动与展示",
    accent: "violet",
  },
  {
    id: "communication",
    name: "通讯",
    icon: "chat",
    description: "消息与联络入口",
    accent: "green",
  },
  {
    id: "tools",
    name: "工具",
    icon: "wrench",
    description: "筛查与处理工具",
    accent: "blue",
  },
];

export const DESKTOP_CARD_SIZE = {
  width: 150,
  height: 150,
  gap: 12,
};

// 桌面各应用弹出的菜单内容。page 是该入口要打开的功能页（与 App 的 openFeature 路由名一致），
// null 表示入口尚未接线，点击只会关闭面板。
// 未读条数、完成进度等运行期数字由调用方传入，避免 config 反向依赖游戏状态。
export function createDesktopMenu({
  unreadMessages = 0,
  completedCount = 0,
  folderTotal = 0,
} = {}) {
  return {
    user: {
      title: "用户",
      subtitle: "个人终端",
      items: [
        { id: "team", name: "我的队伍", detail: "当前组队情况", page: "team" },
        { id: "register", name: "注册", detail: "登录 / 注册", page: "register" },
        { id: "messages", name: "站内信", detail: `${unreadMessages} 条未读`, page: "messages" },
        // 暂未接线，保留原设计意图：
        // { id: "settings", name: "设置", detail: "界面 · 通知", page: null },
        // { id: "tips", name: "tips点", detail: "tips 点可用", page: null },
        { id: "milestone", name: "里程碑", detail: `${completedCount}/${folderTotal} 已完成`, page: "milestone" },
      ],
    },
    archive: {
      title: "档案",
      subtitle: "主线数据库",
      items: [
        { id: "archive-search", name: "快速检索", detail: "待补充", page: "archive" },
        { id: "archive-summary", name: "档案摘要", detail: "待补充", page: null },
        { id: "archive-logs", name: "历史记录", detail: "待补充", page: null },
      ],
    },
    entertainment: {
      title: "娱乐",
      subtitle: "休闲入口",
      items: [
        { id: "entertainment-1", name: "功能一", detail: "待补充", page: null },
        { id: "entertainment-2", name: "功能二", detail: "待补充", page: null },
        { id: "entertainment-3", name: "功能三", detail: "待补充", page: null },
      ],
    },
    communication: {
      title: "通讯",
      subtitle: "联络中心",
      items: [
        { id: "communication-1", name: "功能一", detail: "待补充", page: "communication" },
        { id: "communication-2", name: "功能二", detail: "待补充", page: "communication" },
        { id: "communication-3", name: "功能三", detail: "待补充", page: "communication" },
      ],
    },
    tools: {
      title: "工具",
      subtitle: "处理中心",
      items: [
        { id: "toolbox", name: "常用工具", detail: "网页与资料检索", page: "tools" },
        { id: "timeline", name: "时间线", detail: "剧情事件时间轴", page: "timeline" },
      ],
    },
  };
}
