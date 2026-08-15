import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs";

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
        plugins: [vue()],
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        build: { outDir: outputDir, emptyOutDir: true },
    };
});
