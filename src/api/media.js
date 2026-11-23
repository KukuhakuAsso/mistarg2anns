import request, { fetchWithAuth } from "@/api/request";
import { resolveServerUrl } from "@/config/api";

/**
 * @file 站内信 / 申诉 / 求提示的图片附件（api-8-message-mail.md「发送者与附件」）。
 *
 * 三步链路：`sign` 拿直传地址 → 浏览器直传对象存储（不经过后端）→ 提交业务接口时带 `objectKey`。
 * 与 api-12 的素材上传不同：这条链路**没有 confirm 步骤**，未提交的临时对象由服务端 TTL 清理，
 * 所以前端移除图片时不需要调接口。
 *
 * 规格（选图时就要拦）：每次 ≤3 张、jpg/png/webp、单张 ≤5MiB、长边 ≤1600px。
 * 前端只做校验、不做压缩（压缩率相关的「质量 80」由服务端 / 存储侧保证）。
 * 附件开关看 `GET /api/msg/policy` 的 `attachmentsEnabled`，关闭时隐藏选图入口。
 */

/**
 * 直传描述符。
 * @typedef {Object} MediaUploadDescriptor
 * @property {string} objectKey 对象键；上传成功后随业务请求提交
 * @property {string} url 预签名直传地址（对象存储）
 * @property {string} [method] HTTP 方法，缺省为 `PUT`
 * @property {Object<string, string>} [headers] 必须原样带上的请求头（参与签名计算）
 * @property {string} [expiresAt] 签名过期时间（ISO 8601）
 */

/**
 * 上传签名响应（`POST /api/msg/media/sign` 的 `data`）。
 * @typedef {Object} MediaUploadTicket
 * @property {string} mode 上传模式；当前为 `browser`（浏览器直传预签名地址）
 * @property {MediaUploadDescriptor} upload 直传描述符
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

/**
 * 获取图片上传签名。
 *
 * - 接口：`POST /api/msg/media/sign`
 * - 鉴权：需要访问令牌；个人 / 队伍封禁期间仍可用
 * - 文档：api-8-message-mail.md「发送者与附件」
 *
 * @param {Object} payload
 * @param {string} payload.filename 原始文件名（含扩展名）
 * @param {string} payload.mime MIME 类型，仅 jpg / png / webp
 * @param {number} payload.sizeBytes 原文件字节数（前端不压缩；单张 ≤5MiB）
 * @returns {Promise<{ ok: boolean, data: MediaUploadTicket, req_id: string }>}
 *   直传描述符在 `data.upload`。
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：文件名 / MIME / 大小不合法
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `MSG_IMAGE_DISABLED`：图片附件功能未开启（`attachmentsEnabled=false`）
 *   - 502：对象存储未配置或不可用（服务端错误，提示稍后重试）
 */
export const signMedia = ({ filename, mime, sizeBytes }) =>
  request("/msg/media/sign", {
    method: "POST",
    body: { filename, mime, sizeBytes },
    useAuth: true,
  });

/**
 * 把文件直传到 `signMedia()` 返回的预签名地址（**不经过后端**）。
 *
 * `headers` 必须原样带上：预签名按这些头计算签名，cos 模式下还含 `Pic-Operations`。
 * `Content-Length` 由浏览器自动添加，不要手写。
 *
 * @param {MediaUploadDescriptor} upload `signMedia()` 返回的 `data.upload` 描述符
 * @param {Blob|File} file 要上传的文件
 * @param {(percent: number) => void} [onProgress] 进度回调，收到 0–100 的整数
 * @returns {Promise<void>} 2xx 时 resolve
 * @throws {Error}
 *   - `未获取到上传地址。`：`upload.url` 为空
 *   - `图片上传失败（<status>），请重试。`：对象存储返回非 2xx
 *   - `图片上传中断，请检查网络后重试。`
 *   - `图片上传超时，请重试。`
 *   - `图片上传已取消。`
 */
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

/**
 * 读取受保护图片并转成 Blob。
 *
 * - 接口：`GET /api/msg/media/:id`（服务端 302 到对象存储的短签名地址）
 * - 鉴权：需要访问令牌。入口本身要求登录，**不能**把地址直接塞给 `<img src>`（会 401）；
 *   必须带令牌取字节后再用 `URL.createObjectURL()` 渲染
 * - 文档：api-8-message-mail.md「发送者与附件」
 *
 * 封禁态也可取，但后端只放行申诉邮件（`appeal_ban` / `appeal_mute`）来源的附件。
 *
 * @param {string} url 服务端下发的受保护路径（如 `/api/msg/media/41`）。
 *   内部用 `resolveServerUrl()` 换成本端 API 前缀；外链原样使用且**不携带凭证**
 * @returns {Promise<Blob>} 图片字节
 * @throws {Error}
 *   - `图片地址为空。`：`url` 为空
 *   - `图片加载失败（<status>）。`：非 2xx（401 已由 `fetchWithAuth()` 尝试刷新并重试一次）
 */
export async function fetchMediaBlob(url) {
  const target = resolveServerUrl(url);
  if (!target) throw new Error("图片地址为空。");

  const response = await fetchWithAuth(target);
  if (!response.ok) {
    throw new Error(`图片加载失败（${response.status}）。`);
  }
  return response.blob();
}
