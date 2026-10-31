// 站内信图片附件的规格与本地校验（api-8-message-mail.md §8.3）。
// 前端不做压缩：只要不满足规格就直接拒绝并给出可读原因，
// 满足规格的原图直接走 sign → 直传。

export const IMAGE_MAX_COUNT = 3;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",");

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// 粘贴进来的位图没有文件名，按时间戳造一个（扩展名跟 mime 走）。
export function pastedImageName(mime, at = new Date()) {
  const ext = EXT_BY_MIME[String(mime || "").toLowerCase()] || "png";
  const stamp = [
    at.getFullYear(),
    pad2(at.getMonth() + 1),
    pad2(at.getDate()),
    "-",
    pad2(at.getHours()),
    pad2(at.getMinutes()),
    pad2(at.getSeconds()),
  ].join("");
  return `pasted-${stamp}.${ext}`;
}

// 读取图片原始像素尺寸。优先 createImageBitmap（快、不占 DOM），
// 不支持或解码失败时回落到 Image + objectURL。
// 走 globalThis 取构造器：Node（探针 / SSR）里这些 API 不存在，直接引用会 ReferenceError。
export async function readImageSize(file) {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap === "function") {
    try {
      const bitmap = await createBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      // 某些浏览器对 webp / 超大图会失败，继续走回落方案
    }
  }

  const ImageCtor = globalThis.Image;
  if (typeof ImageCtor !== "function" || typeof URL === "undefined") {
    return null;
  }

  return await new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new ImageCtor();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

// 选图 / 粘贴 / 拖拽都走这里做规格校验。
// 返回 { ok: true, mime, sizeBytes, width, height } 或 { ok: false, reason }。
export async function inspectImageFile(file) {
  if (!file) return { ok: false, reason: "没有可用的图片文件。" };

  const mime = String(file.type || "").toLowerCase();
  if (!IMAGE_MIME_TYPES.includes(mime)) {
    return {
      ok: false,
      reason: `只支持 JPG / PNG / WebP 图片（当前：${mime || "未知格式"}）。`,
    };
  }

  const sizeBytes = Number(file.size) || 0;
  if (sizeBytes <= 0) return { ok: false, reason: "图片内容为空，换一张试试。" };
  if (sizeBytes > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      reason: `单张图片不能超过 5MiB（当前 ${formatBytes(sizeBytes)}）。`,
    };
  }

  const size = await readImageSize(file);
  if (!size || !size.width || !size.height) {
    return { ok: false, reason: "无法读取图片尺寸，请换一张图片。" };
  }

  const longEdge = Math.max(size.width, size.height);
  if (longEdge > IMAGE_MAX_EDGE) {
    return {
      ok: false,
      reason: `图片长边不能超过 ${IMAGE_MAX_EDGE}px（当前 ${size.width}×${size.height}），请先缩小后再上传。`,
    };
  }

  return { ok: true, mime, sizeBytes, width: size.width, height: size.height };
}

// 从剪贴板 / 拖拽的数据里挑出受支持的图片文件。
// 粘贴的位图没有文件名（clipboard item 的 getAsFile 给的是 image.png 之类），统一改名，
// 保证服务端记下的 fileName 与用户看到的一致。
export function pickImageFiles(items, { fromClipboard = false } = {}) {
  const list = Array.from(items || []);
  const files = [];
  const FileCtor = globalThis.File;

  for (const entry of list) {
    if (!entry) continue;

    let file = null;
    if (typeof entry.getAsFile === "function") {
      if (entry.kind && entry.kind !== "file") continue;
      file = entry.getAsFile();
    } else if (FileCtor && entry instanceof FileCtor) {
      file = entry;
    }
    if (!file) continue;

    const mime = String(file.type || "").toLowerCase();
    if (!IMAGE_MIME_TYPES.includes(mime)) continue;

    if (fromClipboard) {
      const name = pastedImageName(mime);
      try {
        if (!FileCtor) throw new Error("no File constructor");
        file = new FileCtor([file], name, { type: mime, lastModified: Date.now() });
      } catch {
        // 极少数环境不支持 File 构造器：保留原名，不影响上传与校验
      }
    }
    files.push(file);
  }

  return files;
}
