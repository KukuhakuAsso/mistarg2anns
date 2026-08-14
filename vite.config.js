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

// ============ WebGAL 集成测试 mock 后端（不魔改版方案） ============
// 动态剧本服务（方案 1）：dev/preview 中拦截引擎对 game/scene/ 下测试剧本的
// 请求，改为按后端状态实时下发（check.txt 按 answer 参数返回正误分支）。
// 使用本地场景名互相引用，是因为本引擎版本（4.6.4）的 choose 解析器会按「:」
// 截断选项目标，完整 URL（含 http:// 冒号）无法作为 choose 的目标。
// 静态托管时中间件不存在，引擎直接读取 game/scene/ 下的同名回退剧本（jumpLabel 判题）。
// 宿主状态接口（方案 4，路径与 projects.json 的 proxyApi=/api-mist 对齐）：
//   GET /api-mist/status   POST /api-mist/mark-puzzle-solved
const STORY_CORRECT_ANSWER = "42";

function storyScripts() {
    return {
        entry(puzzleSolved, answerCorrect) {
            const lines = [
                "setVar:sessionId=mock-001 -global;",
                "changeBg:bg.webp;",
                "",
            ];
            if (puzzleSolved) {
                lines.push(
                    "宿主侧谜题已完成，后端状态已更新。",
                    "iframe 重新加载后，后端直接下发了「已解锁」分支。",
                    "",
                    "changeScene:ending.txt;",
                );
            } else if (answerCorrect === false) {
                lines.push(
                    "答案不对，再想想。（这是后端判定后重新下发的剧本）",
                    "",
                    "changeScene:puzzle.txt;",
                );
            } else {
                lines.push(
                    "欢迎进入 WebGAL × Vue 集成测试。",
                    "这段开场剧本由 mock 后端实时下发（动态剧本流）。",
                    "下面是一个 choose，选择后会请求对应的后端剧本：",
                    "",
                    "choose:走左路:left.txt|走右路:right.txt;",
                );
            }
            return lines.join("\n");
        },

        left() {
            return ["你选择了左路。", "接下来进入谜题环节。", "", "changeScene:puzzle.txt;"].join("\n");
        },

        right() {
            return ["你选择了右路。", "接下来进入谜题环节。", "", "changeScene:puzzle.txt;"].join("\n");
        },

        puzzle() {
            return [
                "changeBg:bg.webp;",
                "请输入谜题答案。",
                "提示：宇宙的终极答案（两位数字）。",
                "getUserInput:answer -title=谜题 -buttonText=提交;",
                "changeScene:check.txt;",
            ].join("\n");
        },

        check(answer) {
            if (answer === STORY_CORRECT_ANSWER) {
                return [
                    "changeBg:bg.webp;",
                    "答对了！后端校验通过。",
                    "这段剧本由后端按答案实时返回。",
                    "",
                    "changeScene:ending.txt;",
                ].join("\n");
            }
            if (answer) {
                return [
                    "答案不对，再想想。（这是后端返回的错误分支）",
                    "",
                    "changeScene:puzzle.txt;",
                ].join("\n");
            }
            // 本引擎版本不支持 changeScene 的 {变量} 插值：答案由宿主捕获后走
            // submit-answer 接口，这里只是过渡场景，宿主判定后会重载 iframe。
            return [
                "答案已提交，后端正在判定并重新下发剧本…",
                "end;",
            ].join("\n");
        },

        ending() {
            return [
                "changeBg:bg.webp;",
                "谜题闭环完成，集成测试流程结束！",
                "你的 sessionId={sessionId}（由 entry 剧本 setVar -global 写入）。",
                "回到测试页点击「重新加载引擎」可再跑一遍。",
                "end;",
            ].join("\n");
        },
    };
}

function mockStoryServer() {
    const state = { puzzleSolved: false, answerCorrect: null };

    function mockMiddleware(req, res, next) {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname;

        const story = pathname.match(/^\/(?:.*\/)?webgal\/game\/scene\/(entry|left|right|puzzle|check|ending)\.txt$/);
        if (story) {
            const scripts = storyScripts();
            const text = {
                entry: () => scripts.entry(state.puzzleSolved, state.answerCorrect),
                left: () => scripts.left(),
                right: () => scripts.right(),
                puzzle: () => scripts.puzzle(),
                check: () => scripts.check(url.searchParams.get("answer") ?? ""),
                ending: () => scripts.ending(),
            }[story[1]]?.();
            if (text !== undefined) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.end(text);
                return;
            }
        }

        const api = pathname.match(/^\/(?:.*\/)?api-mist\/([\w-]+)$/);
        if (api) {
            if (req.method === "GET" && api[1] === "status") {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({
                    mock: true,
                    puzzleSolved: state.puzzleSolved,
                    answerCorrect: state.answerCorrect,
                }));
                return;
            }
            if (req.method === "POST" && api[1] === "submit-answer") {
                const answer = url.searchParams.get("answer") ?? "";
                state.answerCorrect = answer === STORY_CORRECT_ANSWER;
                if (state.answerCorrect) state.puzzleSolved = true;
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({
                    ok: true,
                    answerCorrect: state.answerCorrect,
                    puzzleSolved: state.puzzleSolved,
                }));
                return;
            }
            if (req.method === "POST" && api[1] === "mark-puzzle-solved") {
                state.puzzleSolved = true;
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true, puzzleSolved: true }));
                return;
            }
        }

        next();
    }

    return {
        name: "mock-story-server",
        configureServer(server) {
            server.middlewares.use(mockMiddleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(mockMiddleware);
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");

    // 代理目标统一从环境变量读取（.env.development / .env.development.local）
    const proxyTarget = env.API_PROXY_TARGET;
    const proxyRewrite = env.API_PROXY_REWRITE === "true";

    // 未配置 API_PROXY_TARGET 时跳过代理注册（空 target 会导致 dev server 报错）；
    // 测试阶段的 /api-mist 接口由下方 mockStoryServer 中间件应答。
    const proxy = {};
    if (proxyTarget) {
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
    }

    return {
        base: `/${subPath}/`,
        server: { proxy, port: devPort },
        plugins: [vue(), mockStoryServer()],
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        build: { outDir: outputDir, emptyOutDir: true },
    };
});
