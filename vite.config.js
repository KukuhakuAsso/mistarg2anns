import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs";

import { GAME_DIR, syncGameFiles } from "./scripts/sync-game.mjs";
import { createWebgalSyncServer } from "./scripts/webgal-sync-server.mjs";
import { pruneGameResources } from "./scripts/prune-game-resources.mjs";

// 单一数据源：base / port / 代理前缀 / 输出目录 均来自根目录 projects.json，
// 与主站 config.mjs 的代理转发保持一致，新增子项目无需修改本文件。
const PROJECT_DIR = path.resolve(import.meta.dirname);
const ROOT_DIR = path.resolve(PROJECT_DIR, "..");
const projects = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, "projects.json"), "utf-8"),
);
const self = projects.find(
    (p) => path.resolve(ROOT_DIR, p.dir) === PROJECT_DIR,
);

const subPath = self?.subPath ?? "mistarg/2anns";
const devPort = self?.devPort ?? 5176;
const proxyApi = self?.proxyApi ?? [];
const outputDir = self?.outputDir ?? "output";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 构建时裁剪未引用的游戏资源（发行包自带的演示资源，如 vocal/figure）：
// vite build 会把 public/webgal/ 整体拷进 outDir，这里在产物写出后（closeBundle）
// 对 outDir/webgal/game/ 按「剧本/配置实际引用」做一次裁剪，只保留必要资源。
// 只动构建产物，不碰 public/ 源目录（dev / --force 重下发行包均不受影响）。
function pruneGameResourcesPlugin() {
    return {
        name: "prune-game-resources",
        apply: "build",
        closeBundle() {
            const target = path.resolve(PROJECT_DIR, outputDir, "webgal", "game");
            if (!fs.existsSync(target)) return;
            const { removed, kept, removedList } = pruneGameResources(target);
            if (removed > 0) {
                console.log(
                    `🗑️  构建裁剪：删除 ${removed} 个未引用的演示资源（保留 ${kept} 个）`,
                );
                for (const rel of removedList.slice(0, 20)) {
                    console.log(`   - ${rel}`);
                }
                if (removedList.length > 20) {
                    console.log(`   … 等共 ${removedList.length} 个`);
                }
            } else {
                console.log(`✅ 构建裁剪：无多余演示资源（保留 ${kept} 个）`);
            }
        },
    };
}

// dev 期间监听 game/ 文件夹，内容变化时：
//   - 同步到 public/webgal/game/
//   - 改的是「场景文件」→ 通过 WebGAL 编辑器同步 V1 WebSocket 推送
//     run-scene-content，引擎原地按场景刷新（不回标题页、不重建 iframe）
//   - 改的是 config.txt / flowchart.json / 增删文件等 → 回退为发送自定义
//     HMR 事件 game-updated（宿主 GalPage 仅重载游戏 iframe）
function watchGameSyncPlugin() {
    return {
        name: "watch-game-sync",
        apply: "serve",
        configureServer(server) {
            if (!fs.existsSync(GAME_DIR)) return;
            server.watcher.add(GAME_DIR);

            const syncServer = createWebgalSyncServer({
                logger: server.config.logger,
            });
            syncServer.attach(server.httpServer);

            // 场景文件 = scene/*.txt 或根目录 start.txt
            const isSceneFile = (rel) =>
                rel === "start.txt" ||
                (rel.startsWith("scene/") && rel.endsWith(".txt"));

            let timer = null;
            const scheduleSync = (rel, event) => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    try {
                        syncGameFiles();
                        const srcFile = path.join(GAME_DIR, rel);
                        const isSceneChange =
                            (event === "change" || event === "add") &&
                            isSceneFile(rel) &&
                            fs.existsSync(srcFile);
                        if (isSceneChange) {
                            // 按场景刷新：先进入游戏界面（隐藏标题/菜单），再
                            // run-scene-content 直接把最新文件内容推给引擎播放。
                            // 不用 changeScene 是因为它走 sceneFetcher/fetch，
                            // 可能命中缓存导致显示旧内容；内容直推完全绕过缓存。
                            syncServer.sendCommand(
                                "preview.command.set-component-visibility",
                                {
                                    showTitle: false,
                                    showMenuPanel: false,
                                    showFlowchart: false,
                                    showStarter: false,
                                    isEnterGame: true,
                                },
                            );
                            const content = fs.readFileSync(srcFile, "utf-8");
                            const sent = syncServer.refreshScene(content);
                            if (sent > 0) {
                                // 通知宿主隐藏引擎标题层
                                server.ws.send({
                                    type: "custom",
                                    event: "game-scene-refreshed",
                                });
                                server.config.logger.info(
                                    `🎮 已按场景刷新：${rel}`,
                                );
                                return;
                            }
                            server.config.logger.warn(
                                "WebGAL 引擎未连接，改用 iframe 重载兜底",
                            );
                        }
                        server.ws.send({ type: "custom", event: "game-updated" });
                        server.config.logger.info(
                            "🎮 游戏内容已同步，已通知宿主重载游戏",
                        );
                    } catch (err) {
                        server.config.logger.error(
                            `❌ 同步游戏内容失败：${err?.message ?? err}`,
                        );
                    }
                }, 150);
            };

            server.watcher.on("all", (event, file) => {
                const abs = path.resolve(file);
                if (abs !== GAME_DIR && !abs.startsWith(GAME_DIR + path.sep)) {
                    return;
                }
                const rel = path
                    .relative(GAME_DIR, abs)
                    .split(path.sep)
                    .join("/");
                scheduleSync(rel, event);
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");

    // /api-mist 代理目标（.env.development / .env.development.local）
    const scfTarget = env.API_SCF_TARGET;
    const scfRewrite = env.API_SCF_REWRITE === "true";

    // 未配置 API_SCF_TARGET 时跳过代理注册（空 target 会导致 dev server 报错）
    const proxy = {};
    if (scfTarget) {
        for (const prefix of proxyApi) {
            proxy[prefix] = {
                target: scfTarget,
                changeOrigin: true,
                ...(scfRewrite && {
                    rewrite: (p) =>
                        p.replace(new RegExp(`^${escapeRegExp(prefix)}`), ""),
                }),
            };
        }
    }

    return {
        base: `/${subPath}/`,
        server: { proxy, port: devPort },
        plugins: [vue(), watchGameSyncPlugin(), pruneGameResourcesPlugin()],
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        build: { outDir: outputDir, emptyOutDir: true },
    };
});
