// 档案配置：7 份主线档案 + 1 份隐藏档案（7 + 1）。
//
// 条目类型：
//   kind = "puzzle"  题目，只用于查看
//   kind = "clue"    线索，查看后可加入线索栏自由排布
//
// 正文目前为占位文本，后续替换为正式题面与线索内容。

const PLACEHOLDER = (title) =>
  `【${title}】\n正文待填充：在此放置题面、附件与提示。`;

const TIPS = (title) => [
  `Tips 1：重新阅读「${title}」的题面，注意其中重复出现的信息。`,
  "Tips 2：先整理可直接观察到的元素，再尝试建立它们之间的关联。",
  "Tips 3：当常规阅读没有进展时，检查格式、顺序和隐藏的结构。",
];

const FOLDER_SEEDS = [
  {
    id: "folder-01",
    name: "档案 01",
    subtitle: "起点",
    puzzles: ["第一封信"],
    clues: ["残缺的邮戳", "旧地图残片"],
  },
  {
    id: "folder-02",
    name: "档案 02",
    subtitle: "频率",
    puzzles: ["静默的电波"],
    clues: ["频段记录", "摩尔斯片段"],
  },
  {
    id: "folder-03",
    name: "档案 03",
    subtitle: "图像",
    puzzles: ["多余的像素"],
    clues: ["图种文件", "通道对比表"],
  },
  {
    id: "folder-04",
    name: "档案 04",
    subtitle: "声纹",
    puzzles: ["听不见的节拍"],
    clues: ["频谱截图", "采样率异常"],
  },
  {
    id: "folder-05",
    name: "档案 05",
    subtitle: "时间",
    puzzles: ["跨越时间的五封长信"],
    clues: ["邮戳时间线", "时区偏差"],
  },
  {
    id: "folder-06",
    name: "档案 06",
    subtitle: "密钥",
    puzzles: ["重复的密钥"],
    clues: ["密钥片段", "加密日志"],
  },
  {
    id: "folder-07",
    name: "档案 07",
    subtitle: "终端",
    puzzles: ["最后的登录"],
    clues: ["终端回显", "进程清单"],
  },
  {
    id: "folder-08",
    name: "档案 08",
    subtitle: "未归档",
    hidden: true,
    puzzles: ["档案 08"],
    clues: ["未归档的记录"],
  },
];

function buildFolder(seed, order) {
  const entries = [];

  seed.puzzles.forEach((title, index) => {
    entries.push({
      id: `${seed.id}-p${index + 1}`,
      kind: "puzzle",
      title,
      body: PLACEHOLDER(title),
      tips: TIPS(title),
    });
  });

  seed.clues.forEach((title, index) => {
    entries.push({
      id: `${seed.id}-c${index + 1}`,
      kind: "clue",
      title,
      body: PLACEHOLDER(title),
    });
  });

  return {
    id: seed.id,
    order,
    name: seed.name,
    subtitle: seed.subtitle,
    hidden: Boolean(seed.hidden),
    entries,
  };
}

export const FOLDERS = FOLDER_SEEDS.map((seed, index) =>
  buildFolder(seed, index + 1),
);

export const FOLDER_BY_ID = new Map(
  FOLDERS.map((folder) => [folder.id, folder]),
);

// 主线档案（用于顺序解锁）与隐藏档案（主线全部完成后解锁）
export const MAIN_FOLDERS = FOLDERS.filter((folder) => !folder.hidden);
const HIDDEN_FOLDER = FOLDERS.find((folder) => folder.hidden);
export const HIDDEN_FOLDER_ID = HIDDEN_FOLDER ? HIDDEN_FOLDER.id : "";

// 线索条目索引：id -> { ...entry, folderId, folderName }
export const CLUE_BY_ID = new Map(
  FOLDERS.flatMap((folder) =>
    folder.entries
      .filter((entry) => entry.kind === "clue")
      .map((entry) => [
        entry.id,
        { ...entry, folderId: folder.id, folderName: folder.name },
      ]),
  ),
);
