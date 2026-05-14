export function isExcludedUrl(url: string) {
  return Boolean(getExcludedUrlReason(url));
}

export function getExcludedUrlReason(url: string) {
  if (!url) return "无法识别当前页面地址";
  if (/^(chrome|chrome-extension|chrome-search|chrome-untrusted|edge|about|devtools|view-source):/i.test(url)) {
    return "浏览器系统页面不支持标注";
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "figma.com" || host.endsWith(".figma.com") || host === "figjam.com" || host.endsWith(".figjam.com")) {
      return "Figma / FigJam 页面已排除";
    }
  } catch {
    return "";
  }

  return "";
}
