// scripts/fetch-webgal.mjs
// 拉取官方 WebGAL 网页版「发行包」（GitHub Releases 的 web 构建产物，非源码）
// 解压到 public/webgal/，再把仓库自维护的游戏内容 game/ 覆盖进去。
// public/webgal/ 为生成物，已在 .gitignore 中忽略，不入库。
//
// 用法:
//   node scripts/fetch-webgal.mjs            # 引擎版本未变时仅同步游戏内容，不重新下载
//   node scripts/fetch-webgal.mjs --force    # 强制重新下载引擎并同步游戏内容
//
// 环境变量（可选）:
//   WEBGAL_VERSION      覆盖 package.json 的 webgalVersion
//   WEBGAL_RELEASE_URL  覆盖发行包下载地址（如内网镜像 / ghproxy）
import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, "..");
const DEST_DIR = path.join(PROJECT_DIR, "public", "webgal");
const GAME_DIR = path.join(PROJECT_DIR, "game");
const VERSION_FILE = path.join(DEST_DIR, ".webgal-version");

const pkg = JSON.parse(
    fs.readFileSync(path.join(PROJECT_DIR, "package.json"), "utf-8"),
);
const VERSION = process.env.WEBGAL_VERSION || pkg.webgalVersion || "4.6.4";
const RELEASE_URL =
    process.env.WEBGAL_RELEASE_URL ||
    `https://github.com/OpenWebGAL/WebGAL/releases/download/${VERSION}/WebGAL-${VERSION}-web.zip`;

const force = process.argv.includes("--force");

async function download(url, dest) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(`下载失败：HTTP ${res.status} ${url}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    await fs.promises.writeFile(dest, bytes);
    return bytes.byteLength;
}

// Windows 下删除/移动刚解压的文件可能撞上杀软或句柄占用（EPERM/EBUSY），简单重试
async function retry(fn, label) {
    for (let i = 1; ; i++) {
        try {
            return fn();
        } catch (err) {
            const code = err?.code;
            if ((code === "EPERM" || code === "EBUSY") && i < 5) {
                await new Promise((r) => setTimeout(r, 300 * i));
                console.log(`   ${label} 被占用，重试 ${i}/4…`);
            } else {
                throw err;
            }
        }
    }
}

function overlayGameFiles() {
    // fs.cp 会把目录整体复制成子目录，因此逐项合并，保证内容平铺进 game/
    const gameDest = path.join(DEST_DIR, "game");
    for (const entry of fs.readdirSync(GAME_DIR, { withFileTypes: true })) {
        const src = path.join(GAME_DIR, entry.name);
        const dest = path.join(gameDest, entry.name);
        if (entry.isDirectory()) {
            fs.cpSync(src, dest, { recursive: true, force: true });
        } else {
            fs.copyFileSync(src, dest);
        }
    }
}

async function main() {
    if (!force && fs.existsSync(VERSION_FILE)) {
        const current = fs.readFileSync(VERSION_FILE, "utf-8").trim();
        if (current === VERSION) {
            // 引擎已就绪：不重新下载，仅把仓库自维护的游戏内容覆盖进 game/，
            // 保证每次 dev / build 时 scene 等修改都能立即生效。
            console.log(`✅ WebGAL ${VERSION} 已就绪（${path.relative(PROJECT_DIR, DEST_DIR)}），跳过拉取。`);
            console.log(`🎮 同步游戏内容：${path.relative(PROJECT_DIR, GAME_DIR)} → game/`);
            overlayGameFiles();
            return;
        }
    }

    console.log(`⬇️  拉取官方 WebGAL ${VERSION} 网页版发行包…`);
    console.log(`   ${RELEASE_URL}`);

    const tmpRoot = path.join(PROJECT_DIR, "public", ".webgal-tmp");
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    const zipFile = path.join(os.tmpdir(), `WebGAL-${VERSION}-web.zip`);
    const size = await download(RELEASE_URL, zipFile);
    console.log(`   已下载 ${(size / 1024 / 1024).toFixed(1)} MB`);

    console.log("📦 解压发行包…");
    const zip = new AdmZip(zipFile);
    zip.extractAllTo(tmpRoot, true);

    // 发行包内通常带一层顶层目录（如 WebGAL-4.6.4-web/），剥离后落位；
    // 没有顶层目录时（文件直接平铺在根）直接使用解压根目录
    const tops = fs.readdirSync(tmpRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    const contentDir = tops
        .map((e) => path.join(tmpRoot, e.name))
        .find((c) => fs.existsSync(path.join(c, "index.html"))) ?? tmpRoot;

    await retry(() => {
        fs.rmSync(DEST_DIR, { recursive: true, force: true });
        fs.cpSync(contentDir, DEST_DIR, { recursive: true, force: true });
    }, "落位发行包");
    await retry(() => fs.rmSync(tmpRoot, { recursive: true, force: true }), "清理临时目录");
    await retry(() => fs.rmSync(zipFile, { force: true }), "清理下载缓存");

    console.log(`🎮 覆盖游戏内容：${path.relative(PROJECT_DIR, GAME_DIR)} → game/`);
    overlayGameFiles();

    fs.writeFileSync(VERSION_FILE, `${VERSION}\n`);
    console.log(`✅ 完成：${path.relative(PROJECT_DIR, DEST_DIR)}（WebGAL ${VERSION}）`);
}

main().catch((err) => {
    console.error("❌ WebGAL 拉取失败：", err.message ?? err);
    process.exit(1);
});
