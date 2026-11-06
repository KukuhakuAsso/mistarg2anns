// 里程碑页的展示数据。
//
// 后端目前只有管理端的 /api/admin/milestones，玩家侧没有「里程碑一览」接口
// （能拿到的只有 GET /api/progress 里本队已达成的 milestones 数组），
// 所以本页仍是静态展示：目录名来自下面的清单，时间表与完成率是示例值。
//
// 注意：题目结构、解锁与解题进度请走 GET /api/puzzle/map 与 GET /api/progress，
// 不要在本文件里再造题目数据。

const FOLDER_LABELS = [
  { id: "folder-01", name: "档案 01", subtitle: "起点" },
  { id: "folder-02", name: "档案 02", subtitle: "频率" },
  { id: "folder-03", name: "档案 03", subtitle: "图像" },
  { id: "folder-04", name: "档案 04", subtitle: "声纹" },
  { id: "folder-05", name: "档案 05", subtitle: "时间" },
  { id: "folder-06", name: "档案 06", subtitle: "密钥" },
  { id: "folder-07", name: "档案 07", subtitle: "终端" },
];

const schedule = [
  { unlockHour: 9, unlockMinute: 15, completedHour: 10, completedMinute: 6, issueDone: 100, milestoneCount: 3 },
  { unlockHour: 10, unlockMinute: 12, completedHour: 11, completedMinute: 4, issueDone: 100, milestoneCount: 4 },
  { unlockHour: 11, unlockMinute: 28, completedHour: 12, completedMinute: 14, issueDone: 100, milestoneCount: 5 },
  { unlockHour: 12, unlockMinute: 40, completedHour: 13, completedMinute: 25, issueDone: 100, milestoneCount: 4 },
  { unlockHour: 13, unlockMinute: 50, completedHour: 14, completedMinute: 44, issueDone: 100, milestoneCount: 5 },
  { unlockHour: 15, unlockMinute: 5, completedHour: 16, completedMinute: 2, issueDone: 100, milestoneCount: 6 },
  { unlockHour: 16, unlockMinute: 20, completedHour: 17, completedMinute: 19, issueDone: 100, milestoneCount: 7 },
];

function formatMinutes(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildMilestoneRows(folders = FOLDER_LABELS) {
  return folders.map((folder, index) => {
    const row = schedule[index] ?? schedule[schedule.length - 1];
    const unlockDate = new Date(2026, 3, 8 + index, row.unlockHour, row.unlockMinute);
    const completedDate = new Date(2026, 3, 8 + index, row.completedHour, row.completedMinute);
    const durationMinutes = Math.max(0, (completedDate.getTime() - unlockDate.getTime()) / 60000);

    return {
      id: folder.id,
      folderName: folder.name,
      subtitle: folder.subtitle,
      unlockTime: formatDate(unlockDate),
      completedTime: formatDate(completedDate),
      totalDuration: formatMinutes(durationMinutes),
      issueCompletion: `${row.issueDone}%`,
      milestoneCount: row.milestoneCount,
    };
  });
}

export const MILESTONE_ROWS = buildMilestoneRows();
