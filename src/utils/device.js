// 设备标识（api-13 §四的 device 字段）：稳定、可读、≤64 字符。
//
// 不要传整段 User-Agent（上限 64）：这里只取「浏览器 + 平台」，
// 例如 web-chrome-win / web-safari-ios / web-edge-mac。同一设备每次上传保持一致，
// 另一端才能辨认「这条改动来自哪台设备」。

function detectBrowser(ua) {
  if (/Edg\//i.test(ua)) return "edge";
  if (/OPR\/|Opera/i.test(ua)) return "opera";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  return "browser";
}

function detectPlatform(ua) {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "win";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

export function describeDevice() {
  if (typeof navigator === "undefined") return "web-unknown-unknown";
  const ua = navigator.userAgent || "";
  return `web-${detectBrowser(ua)}-${detectPlatform(ua)}`;
}

export default describeDevice;
