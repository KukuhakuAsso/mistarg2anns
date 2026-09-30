import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs";

// 单一数据源：base / port / 代理前缀 / 输出目录 均来自根目录 projects.json，
// 与主站 config.mjs 的代理转发保持一致，新增子项目无需修改本文件。
const PROJECT_DIR = path.resolve(import.meta.dirname);
const ROOT_DIR = path.resolve(PROJECT_DIR, "..");

// projects.json 只存在于 monorepo 主仓库中；本仓库作为独立仓库单独 clone 时
// （例如 GitHub Actions 部署本仓库自己的 Pages）该文件不存在，此时退回下方默认值，
// 保证不依赖主仓库也能独立构建。
const PROJECTS_FILE = path.join(ROOT_DIR, "projects.json");
const projects = fs.existsSync(PROJECTS_FILE)
    ? JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"))
    : [];
const self = projects.find(
    (p) => path.resolve(ROOT_DIR, p.dir) === PROJECT_DIR,
);

const subPath = self?.subPath ?? "mistarg/2anns";
const devPort = self?.devPort ?? 5176;
const proxyApi = self?.proxyApi ?? [];
const outputDir = self?.outputDir ?? "output";

// 部署 base：默认沿用 monorepo 子路径；独立部署（如本仓库自己的 GitHub Pages）时
// 用环境变量 DEPLOY_BASE 覆盖，例如 DEPLOY_BASE=/mistarg2anns/。
const base = process.env.DEPLOY_BASE
    ? `/${String(process.env.DEPLOY_BASE).replace(/^\/+|\/+$/g, "")}/`
    : `/${subPath}/`;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");

    // 代理目标统一从环境变量读取（.env.development / .env.development.local）
    const proxyTarget = env.API_PROXY_TARGET;
    const proxyRewrite = env.API_PROXY_REWRITE === "true";

    const proxy = {};
    for (const prefix of proxyApi) {
        proxy[prefix] = {
            target: proxyTarget,
            changeOrigin: true,
            ...(proxyRewrite && {
                rewrite: (p) =>
                    p.replace(new RegExp(`^${escapeRegExp(prefix)}`), ""),
            }),
        };
    }

    return {
        base,
        server: { proxy, port: devPort },
        plugins: [vue()],
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        build: { outDir: outputDir, emptyOutDir: true },
    };
});
