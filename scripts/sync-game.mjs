// scripts/sync-game.mjs
// 共享的「游戏内容 game/ → public/webgal/game/」同步模块：
//   - scripts/fetch-webgal.mjs（predev / prebuild）在引擎就绪后调用它覆盖游戏内容
//   - vite.config.js 的 watch 插件在 dev 期间监听 game/ 变化并实时调用它同步
//
// 同步策略（清单式合并，不整体重建）：
//   public/webgal/game/ 中混有发行包自带资源（background/、bgm/、figure/ 等，
//   被 config.txt 与剧本引用），它们不在仓库的 game/ 里，绝不能删除。
//   因此用 .game-sync-manifest.json 记录「上一次由本脚本写入的文件」，
//   同步时只删除清单中已消失的文件，实现删除同步的同时保留发行包资源。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_DIR = path.resolve(__dirname, "..");
export const GAME_DIR = path.join(PROJECT_DIR, "game");
export const WEBGAL_DIR = path.join(PROJECT_DIR, "public", "webgal");
export const GAME_DEST_DIR = path.join(WEBGAL_DIR, "game");

// 清单放在 game/ 之外，避免污染游戏内容
const MANIFEST_FILE = path.join(WEBGAL_DIR, ".game-sync-manifest.json");

// 跨平台路径规范化（清单里统一存 POSIX 风格，避免 Windows/Linux 分隔符差异）
const toPosix = (p) => p.split(path.sep).join("/");
const fromPosix = (p) => p.split("/").join(path.sep);

function listFilesRecursive(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFilesRecursive(p));
        else out.push(p);
    }
    return out;
}

// 删除文件后向上清理空目录（止步于 GAME_DEST_DIR 本身）
function removeEmptyParentDirs(file) {
    let dir = path.dirname(file);
    while (
        dir.startsWith(GAME_DEST_DIR + path.sep) &&
        dir !== GAME_DEST_DIR
    ) {
        try {
            if (fs.readdirSync(dir).length > 0) break;
            fs.rmdirSync(dir);
            dir = path.dirname(dir);
        } catch {
            break;
        }
    }
}

export function syncGameFiles() {
    fs.mkdirSync(GAME_DEST_DIR, { recursive: true });

    // 1. 删除「上次写入、现在已从 game/ 移除」的文件（删除同步）
    let prev = [];
    try {
        prev = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf-8"));
    } catch {
        prev = []; // 首次同步（或发行包刚重新解压）：不删除任何文件
    }
    const current = new Set(
        listFilesRecursive(GAME_DIR).map((f) =>
            toPosix(path.relative(GAME_DIR, f)),
        ),
    );
    for (const rel of prev) {
        if (!current.has(rel)) {
            const target = path.join(GAME_DEST_DIR, fromPosix(rel));
            fs.rmSync(target, { force: true });
            removeEmptyParentDirs(target);
        }
    }

    // 2. 覆盖复制 game/ 全部内容（发行包中未被我们管理的文件原样保留）
    for (const entry of fs.readdirSync(GAME_DIR, { withFileTypes: true })) {
        const src = path.join(GAME_DIR, entry.name);
        const dest = path.join(GAME_DEST_DIR, entry.name);
        if (entry.isDirectory()) {
            fs.cpSync(src, dest, { recursive: true, force: true });
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    // 3. 更新清单
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify([...current].sort(), null, 2));
}

