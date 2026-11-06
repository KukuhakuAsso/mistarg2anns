// 可塑区组件的完整性校验（api-12：asset.integrity 形如 `sha384-<base64>`）。
// 校验不通过时必须中止，不能执行任何代码。

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Uint8Array → base64；不依赖 Buffer / btoa，浏览器与 node --test 都能用。
export function toBase64(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    output += BASE64_ALPHABET[a >> 2];
    output += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? "=" : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? "=" : BASE64_ALPHABET[c & 63];
  }
  return output;
}

// 用响应文本重算 sha384 并与描述符里的 integrity 比对（只认 `sha384-` 前缀）。
export async function verifySha384(source, integrity) {
  const expected = String(integrity ?? "").trim();
  const match = /^sha384-([A-Za-z0-9+/]+={0,2})$/.exec(expected);
  if (!match) return false;

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-384",
    new TextEncoder().encode(String(source ?? "")),
  );
  return toBase64(new Uint8Array(digest)) === match[1];
}
