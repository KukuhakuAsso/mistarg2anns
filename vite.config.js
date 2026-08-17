import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs";

import { GAME_DIR, syncGameFiles } from "./scripts/sync-game.mjs";

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

// dev 期间监听 game/ 文件夹：内容变化时实时同步到 public/webgal/game/
// 并刷新页面，修改 scene/*.txt、config.txt 等剧本无需重启 dev server。
function watchGameSyncPlugin() {
    return {
        name: "watch-game-sync",
        apply: "serve",
        configureServer(server) {
            if (!fs.existsSync(GAME_DIR)) return;
            server.watcher.add(GAME_DIR);

            let timer = null;
            const scheduleSync = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    try {
                        syncGameFiles();
                        server.ws.send({ type: "full-reload" });
                        server.config.logger.info("🎮 游戏内容已同步，页面已刷新");
                    } catch (err) {
                        server.config.logger.error(
                            `❌ 同步游戏内容失败：${err?.message ?? err}`,
                        );
                    }
                }, 150);
            };

            server.watcher.on("all", (_event, file) => {
                const abs = path.resolve(file);
                if (abs === GAME_DIR || abs.startsWith(GAME_DIR + path.sep)) {
                    scheduleSync();
                }
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
        plugins: [vue(), watchGameSyncPlugin()],
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        build: { outDir: outputDir, emptyOutDir: true },
    };
});
