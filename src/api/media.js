import request, { fetchWithAuth } from "@/api/request";
import { resolveServerUrl } from "@/config/api";

// 站内信图片附件（api-8-message-mail.md §8.3，2026-10-31 起）。
// 三步：sign（拿直传地址）→ PUT 直传对象存储 → 提交业务接口时带 objectKey。
// 与 api-12 的素材上传不同：这条链路没有 confirm 步骤，objectKey 直接随业务请求提交，
// 未提交的临时对象由服务端 TTL 清理（已与后端确认，前端移除图片时不需要调接口）。
//
// 规格（前端选图时就要拦）：≤3 张/次、jpg/png/webp、单张 ≤5MiB、长边 ≤1600px。
// 口径：前端不做压缩，只做校验（压缩率相关的「质量 80」由服务端 / 存储侧保证）。

// 图片上传签名（POST /api/msg/media/sign）：sizeBytes = 原文件字节数（前端不压缩）。
// 统一拆掉 { ok, data } 信封，返回 { mode, upload: { objectKey, url, method, headers, expiresAt } }；
// 开关关闭 → 403 MSG_IMAGE_DISABLED，对象存储未配置 → 502。
export const signMedia = async ({ filename, mime, sizeBytes }) => {
  const payload = await request("/msg/media/sign", {
    method: "POST",
    body: { filename, mime, sizeBytes },
    useAuth: true,
  });
  return payload?.data ?? null;
};

// 直传本体：按 sign 返回的方式把文件 PUT 到对象存储（不经过后端）。
// 返回 Promise，2xx 时 resolve；onProgress 收到 0–100。
// headers 必须原样带上（预签名按这些头计算签名；cos 模式下还含 Pic-Operations）。
// Content-Length 由浏览器自动添加，这里不要手写。
export function uploadToSignedUrl(upload, file, onProgress) {
  const { url, method = "PUT", headers = {} } = upload ?? {};

  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("未获取到上传地址。"));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    for (const [key, value] of Object.entries(headers || {})) {
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        // 少数头（如受保护头）浏览器不允许设置，忽略即可
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress?.(Math.min(100, Math.max(0, percent)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(`图片上传失败（${xhr.status}），请重试。`));
    };
    xhr.onerror = () => reject(new Error("图片上传中断，请检查网络后重试。"));
    xhr.ontimeout = () => reject(new Error("图片上传超时，请重试。"));
    xhr.onabort = () => reject(new Error("图片上传已取消。"));

    xhr.send(file);
  });
}

// 取受保护图片（GET /api/msg/media/:id）：接口会 302 到对象存储的短签名地址，
// 但入口本身要求登录，所以不能把地址直接塞给 <img src>（会 401），
// 必须带令牌取字节后转 blob URL。url 用 resolveServerUrl 换成本端 API 前缀。
export async function fetchMediaBlob(url) {
  const target = resolveServerUrl(url);
  if (!target) throw new Error("图片地址为空。");

  const response = await fetchWithAuth(target);
  if (!response.ok) {
    throw new Error(`图片加载失败（${response.status}）。`);
  }
  return response.blob();
}
