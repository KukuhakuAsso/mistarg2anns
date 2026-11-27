// 设备标识
//
// 这里只取「浏览器 + 平台」，
// 例如 web-chrome-win / web-safari-ios / web-edge-mac。
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
  const ua = globalThis.navigator?.userAgent || "";
  return `web-${detectBrowser(ua)}-${detectPlatform(ua)}`;
}

export default describeDevice;
