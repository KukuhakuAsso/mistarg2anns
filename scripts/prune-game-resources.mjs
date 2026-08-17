// scripts/prune-game-resources.mjs
// 构建时资源裁剪：只保留剧本/配置实际引用的资源文件，删除发行包自带但未被引用的
// 演示资源（如 vocal/、figure/ 等），缩小打包体积。
//
// 设计要点：
//   - 只作用于【构建产物】（如 output/webgal/game/），绝不改动 public/webgal/game/
//     源目录 → dev 与 --force 重下发行包都不受影响。
//   - 仅在少数「资源目录」（background/bgm/figure/vocal）内按引用保留；
//     其余目录（scene/animation/template 等）与文件一律保留（引擎必需）。
//
// 用法:
//   node scripts/prune-game-resources.mjs [targetGameDir]   # 手动对某目录执行
//   vite.config.js 的 build 插件会在 closeBundle 时自动对 outDir 执行。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GAME_DIR } from "./sync-game.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 仅在这几个资源目录内做「按引用保留」裁剪；其余目录/文件一律保留
const PRUNABLE_DIRS = ["background", "bgm", "figure", "vocal"];

// 常见资源指令：冒号后的值即资源文件名（可能带子路径/扩展名）
const ASSET_CMD_RE =
    /(?:changeBg|setBg|changeFigure|setFigure|addFigure|playBgm|setBgm|playVocal|stopVocal)\s*:\s*([^\s;]+)/gi;

const stemOf = (name) => name.replace(/\.[^.]+$/, "").toLowerCase();

// 从 game/（config.txt + start.txt + 全部 scene/*.txt）提取被引用的资源名集合。
// 同时存「完整文件名」与「去扩展名的 stem」，兼容 changeFigure: stand 这类无扩展引用。
export function collectReferencedAssets() {
    const refs = new Set();
    const files = [
        path.join(GAME_DIR, "config.txt"),
        path.join(GAME_DIR, "start.txt"),
    ];
    const sceneDir = path.join(GAME_DIR, "scene");
    if (fs.existsSync(sceneDir)) {
        for (const e of fs.readdirSync(sceneDir)) {
            if (e.endsWith(".txt")) files.push(path.join(sceneDir, e));
        }
    }

    for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, "utf-8");
        // 1) 直接匹配带扩展名的资源文件名
        for (const m of text.matchAll(
            /[\w.\-]+\.(webp|png|jpe?g|gif|bmp|mp3|wav|ogg|flac|ttf|woff2?)/gi,
        )) {
            refs.add(m[0].toLowerCase());
            refs.add(stemOf(m[0]));
        }
        // 2) 匹配资源指令的值（可能不带扩展名，如 changeFigure: stand）
        for (const m of text.matchAll(ASSET_CMD_RE)) {
            const v = m[1].split(/[|;-]/)[0].trim().toLowerCase();
            if (v) {
                refs.add(v);
                refs.add(stemOf(v));
            }
        }
    }
    return refs;
}

function listFilesRecursive(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFilesRecursive(p));
        else out.push(p);
    }
    return out;
}

function removeEmptyDirs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
    }
    try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
        /* 非空或占用则跳过 */
    }
}

// 对目标 game 目录执行裁剪。返回统计信息。
export function pruneGameResources(targetGameDir) {
    if (!fs.existsSync(targetGameDir)) {
        return { removed: 0, kept: 0, removedList: [], target: targetGameDir };
    }
    const refs = collectReferencedAssets();
    let removed = 0;
    let kept = 0;
    const removedList = [];

    for (const dir of PRUNABLE_DIRS) {
        const abs = path.join(targetGameDir, dir);
        if (!fs.existsSync(abs)) continue;
        for (const file of listFilesRecursive(abs)) {
            const base = path.basename(file).toLowerCase();
            const matched = refs.has(base) || refs.has(stemOf(base));
            if (matched) {
                kept++;
            } else {
                // ⚠️ Windows 下 fs.rmSync 对含全角/日文字符的路径会崩溃
                //（进程 exit 9），改用 fs.unlinkSync 安全删除文件
                fs.unlinkSync(file);
                removed++;
                removedList.push(path.relative(targetGameDir, file));
            }
        }
        removeEmptyDirs(abs);
    }
    return { removed, kept, removedList, target: targetGameDir };
}

