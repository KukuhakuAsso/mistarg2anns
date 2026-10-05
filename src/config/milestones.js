import { MAIN_FOLDERS } from "./folders";

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

export function buildMilestoneRows(folders = MAIN_FOLDERS) {
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
