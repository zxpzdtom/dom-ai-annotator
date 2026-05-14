import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "assets", "chrome-store");
mkdirSync(outDir, { recursive: true });

const iconData = readFileSync(join(root, "assets", "icon-128.png")).toString("base64");
const iconHref = `data:image/png;base64,${iconData}`;

const colors = {
  bg: "#07111f",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#d8e0eb",
  panel: "#f8fafc",
  brand: "#087c62",
  brand2: "#0f9f78",
  sky: "#0ea5e9",
  orange: "#f97316",
  red: "#ef4444"
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function textBlock(lines, x, y, options = {}) {
  const {
    size = 28,
    fill = colors.ink,
    weight = 700,
    lineHeight = 1.22,
    anchor = "start",
    family = "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  } = options;
  const dy = size * lineHeight;
  return `<g>${lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * dy}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="0">${escapeXml(line)}</text>`
    )
    .join("")}</g>`;
}

function pill(label, x, y, width, fill = "#eefdf7", color = colors.brand) {
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="36" rx="18" fill="${fill}"/>
    ${textBlock([label], x + width / 2, y + 24, { size: 15, fill: color, weight: 800, anchor: "middle" })}
  </g>`;
}

function browserChrome(x, y, w, h, url = "app.example.com/pricing") {
  return `<g filter="url(#shadow)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#f8fafc" stroke="rgba(255,255,255,0.46)"/>
    <rect x="${x}" y="${y}" width="${w}" height="58" rx="22" fill="#ffffff"/>
    <rect x="${x}" y="${y + 36}" width="${w}" height="22" fill="#ffffff"/>
    <circle cx="${x + 28}" cy="${y + 29}" r="6.5" fill="#cbd5e1"/>
    <circle cx="${x + 50}" cy="${y + 29}" r="6.5" fill="#cbd5e1"/>
    <circle cx="${x + 72}" cy="${y + 29}" r="6.5" fill="#cbd5e1"/>
    <rect x="${x + 98}" y="${y + 17}" width="${w - 126}" height="26" rx="13" fill="#eef2f7"/>
    ${textBlock([url], x + 116, y + 36, { size: 13, fill: colors.muted, weight: 650 })}
  </g>`;
}

function sidePanel(x, y, w, h, title = "页面标注") {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0" fill="#f8fafc" stroke="${colors.line}"/>
    ${textBlock([title], x + 24, y + 42, { size: 22, fill: colors.ink, weight: 820 })}
    <rect x="${x + 24}" y="${y + 62}" width="96" height="34" rx="10" fill="${colors.brand}"/>
    ${textBlock(["选择元素"], x + 72, y + 84, { size: 14, fill: "#ffffff", weight: 800, anchor: "middle" })}
    <rect x="${x + 130}" y="${y + 62}" width="96" height="34" rx="10" fill="#e8eef6"/>
    ${textBlock(["测量距离"], x + 178, y + 84, { size: 14, fill: "#334155", weight: 800, anchor: "middle" })}
  </g>`;
}

function annotationCard(x, y, w, label, body, status = "待处理", tone = colors.brand) {
  return `<g filter="url(#softShadow)">
    <rect x="${x}" y="${y}" width="${w}" height="104" rx="14" fill="#ffffff" stroke="${colors.line}"/>
    ${textBlock([label], x + 16, y + 26, { size: 13, fill: colors.muted, weight: 800 })}
    <rect x="${x + w - 78}" y="${y + 13}" width="60" height="24" rx="12" fill="${tone}18"/>
    ${textBlock([status], x + w - 48, y + 30, { size: 12, fill: tone, weight: 850, anchor: "middle" })}
    ${textBlock(body, x + 16, y + 57, { size: 16, fill: "#253244", weight: 650, lineHeight: 1.3 })}
  </g>`;
}

function defs() {
  return `<defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#000000" flood-opacity="0.2"/>
    </filter>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="11" flood-color="#0f172a" flood-opacity="0.08"/>
    </filter>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07111f"/>
      <stop offset="0.48" stop-color="#0b1120"/>
      <stop offset="1" stop-color="#123044"/>
    </linearGradient>
    <radialGradient id="glowA" cx="12%" cy="2%" r="62%">
      <stop offset="0" stop-color="#0f9f78" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#0f9f78" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="90%" cy="7%" r="52%">
      <stop offset="0" stop-color="#0ea5e9" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

function bg(width, height) {
  return `<rect width="${width}" height="${height}" fill="url(#hero)"/>
    <rect width="${width}" height="${height}" fill="url(#glowA)"/>
    <rect width="${width}" height="${height}" fill="url(#glowB)"/>
    <g opacity="0.13">
      ${Array.from({ length: Math.ceil(width / 44) }, (_, i) => `<line x1="${i * 44}" y1="0" x2="${i * 44}" y2="${height}" stroke="#ffffff"/>`).join("")}
      ${Array.from({ length: Math.ceil(height / 44) }, (_, i) => `<line x1="0" y1="${i * 44}" x2="${width}" y2="${i * 44}" stroke="#ffffff"/>`).join("")}
    </g>`;
}

function screenshotBase(title, subtitle, scene) {
  const width = 1280;
  const height = 800;
  return svg(width, height, `
    ${bg(width, height)}
    <image href="${iconHref}" x="58" y="54" width="58" height="58"/>
    ${textBlock(["DOM AI 标注器"], 132, 92, { size: 30, fill: "#ffffff", weight: 850 })}
    ${textBlock(title, 58, 190, { size: 54, fill: "#ffffff", weight: 860, lineHeight: 1.08 })}
    ${textBlock(subtitle, 62, 322, { size: 23, fill: "#cbd5e1", weight: 560, lineHeight: 1.36 })}
    ${scene}
  `);
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${defs()}
    ${body}
  </svg>`;
}

const assets = [
  {
    name: "promo-small-440x280",
    width: 440,
    height: 280,
    content: svg(
      440,
      280,
      `${bg(440, 280)}
      <image href="${iconHref}" x="34" y="34" width="52" height="52"/>
      ${textBlock(["DOM AI", "标注器"], 34, 122, { size: 40, fill: "#ffffff", weight: 860, lineHeight: 1.05 })}
      ${textBlock(["网页反馈", "绑定 DOM"], 36, 210, { size: 18, fill: "#cbd5e1", weight: 650, lineHeight: 1.24 })}
      <g transform="translate(244 46)">
        <rect width="158" height="160" rx="18" fill="#f8fafc" filter="url(#shadow)"/>
        <rect x="18" y="24" width="78" height="16" rx="8" fill="#dbeafe"/>
        <rect x="18" y="54" width="122" height="20" rx="10" fill="#ffffff" stroke="${colors.line}"/>
        <rect x="18" y="88" width="94" height="20" rx="10" fill="#eefdf7" stroke="#a7f3d0"/>
        <circle cx="126" cy="86" r="20" fill="${colors.brand}"/>
        ${textBlock(["1"], 126, 93, { size: 18, fill: "#ffffff", weight: 850, anchor: "middle" })}
      </g>`
    )
  },
  {
    name: "promo-marquee-1400x560",
    width: 1400,
    height: 560,
    content: svg(
      1400,
      560,
      `${bg(1400, 560)}
      <image href="${iconHref}" x="76" y="68" width="70" height="70"/>
      ${textBlock(["DOM AI 标注器"], 166, 112, { size: 40, fill: "#ffffff", weight: 850 })}
      ${textBlock(["标注网页反馈", "交给 AI 开发"], 78, 230, { size: 60, fill: "#ffffff", weight: 860, lineHeight: 1.08 })}
      ${textBlock(["点选 DOM、测量间距、", "导出 Markdown。"], 84, 392, { size: 24, fill: "#cbd5e1", weight: 560, lineHeight: 1.34 })}
      ${pill("Chrome Side Panel", 84, 456, 190, "#eefdf7", colors.brand)}
      ${pill("AI-ready Markdown", 294, 456, 196, "#eff6ff", colors.sky)}
      ${browserChrome(656, 64, 626, 410)}
      <rect x="700" y="170" width="280" height="102" rx="16" fill="#ffffff" stroke="${colors.line}"/>
      <rect x="700" y="170" width="280" height="102" rx="16" fill="none" stroke="${colors.brand2}" stroke-width="4"/>
      <circle cx="963" cy="156" r="22" fill="${colors.brand2}" stroke="#ffffff" stroke-width="5"/>
      ${textBlock(["1"], 963, 164, { size: 18, fill: "#ffffff", weight: 850, anchor: "middle" })}
      ${sidePanel(1016, 122, 266, 352)}
      ${annotationCard(1040, 236, 218, "#1 button.primary", ["CTA 间距过近，", "移动端需增加留白。"])}
      ${annotationCard(1040, 354, 218, "#2 .price-card", ["卡片 hover 状态", "缺少明确层级。"], "已发送", colors.sky)}`
    )
  },
  {
    name: "screenshot-01-select-1280x800",
    width: 1280,
    height: 800,
    content: screenshotBase(
      ["点选页面元素，", "反馈绑定 DOM"],
      ["记录 selector、XPath、位置和样式，", "不用再靠截图猜位置。"],
      `${browserChrome(522, 72, 664, 592, "app.example.com/dashboard")}
      <rect x="568" y="212" width="302" height="132" rx="18" fill="#ffffff" stroke="${colors.brand2}" stroke-width="4"/>
      <rect x="592" y="242" width="178" height="18" rx="9" fill="#dbeafe"/>
      <rect x="592" y="280" width="226" height="18" rx="9" fill="#e2e8f0"/>
      <rect x="592" y="310" width="138" height="18" rx="9" fill="#eefdf7"/>
      <circle cx="852" cy="198" r="24" fill="${colors.brand2}" stroke="#ffffff" stroke-width="5"/>
      ${textBlock(["1"], 852, 207, { size: 20, fill: "#ffffff", weight: 850, anchor: "middle" })}
      <rect x="704" y="148" width="206" height="100" rx="16" fill="#0b1120" filter="url(#shadow)"/>
      ${textBlock(["元素旁评论"], 726, 184, { size: 20, fill: "#ffffff", weight: 820 })}
      ${textBlock(["自动带上", "完整上下文"], 726, 216, { size: 16, fill: "#cbd5e1", weight: 600, lineHeight: 1.25 })}
      ${sidePanel(928, 130, 258, 534)}
      ${annotationCard(952, 256, 210, "#1 .metric-card", ["标题和数值之间", "需要增加 12px。"])}
      ${annotationCard(952, 376, 210, "#2 nav button", ["当前态颜色不够", "清晰。"], "待处理", colors.orange)}`
    )
  },
  {
    name: "screenshot-02-panel-1280x800",
    width: 1280,
    height: 800,
    content: screenshotBase(
      ["按状态管理，", "让反馈继续往前走"],
      ["状态流转清晰，", "每条反馈都有下一步。"],
      `<g filter="url(#shadow)">
        <rect x="558" y="68" width="608" height="612" rx="24" fill="#f8fafc"/>
        <rect x="558" y="68" width="608" height="74" rx="24" fill="#ffffff"/>
        <rect x="558" y="118" width="608" height="24" fill="#ffffff"/>
        ${textBlock(["标注管理"], 592, 114, { size: 28, fill: colors.ink, weight: 850 })}
        ${pill("app.example.com/pricing · 6 条", 830, 88, 282, "#eef2f7", colors.muted)}
        ${["全部", "待处理", "已发送", "已修改", "仍有问题", "已通过"].map((label, i) => `<rect x="${592 + i * 88}" y="170" width="76" height="36" rx="10" fill="${i === 0 ? colors.brand : "#e8eef6"}"/>${textBlock([label], 630 + i * 88, 193, { size: 14, fill: i === 0 ? "#ffffff" : "#475569", weight: 800, anchor: "middle" })}`).join("")}
        ${annotationCard(592, 236, 526, "#1 button.primary", ["主 CTA 间距太紧，移动端需要保留呼吸感。"], "高优先级", colors.orange)}
        ${annotationCard(592, 366, 526, "#2 .pricing-card", ["卡片 hover 层级不足，建议补充边框和阴影状态。"], "已发送", colors.sky)}
        ${annotationCard(592, 496, 526, "#3 form .error", ["底部表单缺少错误态说明，需要补充文案。"], "仍有问题", colors.red)}
      </g>`
    )
  },
  {
    name: "screenshot-03-measure-1280x800",
    width: 1280,
    height: 800,
    content: screenshotBase(
      ["测量间距，", "用像素说明问题"],
      ["按 M 开始测量，", "固定两个元素距离。"],
      `<g filter="url(#shadow)">
        <rect x="536" y="78" width="650" height="580" rx="24" fill="#ffffff"/>
        <rect x="536" y="78" width="650" height="580" rx="24" fill="none" stroke="rgba(255,255,255,0.48)"/>
        <g opacity="0.7">
          ${Array.from({ length: 22 }, (_, i) => `<line x1="${564 + i * 28}" y1="118" x2="${564 + i * 28}" y2="620" stroke="#e2e8f0"/>`).join("")}
          ${Array.from({ length: 18 }, (_, i) => `<line x1="564" y1="${118 + i * 28}" x2="1150" y2="${118 + i * 28}" stroke="#e2e8f0"/>`).join("")}
        </g>
        <rect x="610" y="190" width="224" height="116" rx="16" fill="#f8fafc" stroke="${colors.brand2}" stroke-width="4"/>
        <rect x="916" y="372" width="222" height="126" rx="16" fill="#f8fafc" stroke="${colors.sky}" stroke-width="4"/>
        <line x1="834" y1="306" x2="916" y2="372" stroke="${colors.orange}" stroke-width="6" stroke-linecap="round"/>
        <rect x="824" y="328" width="112" height="42" rx="21" fill="${colors.orange}"/>
        ${textBlock(["168 px"], 880, 356, { size: 21, fill: "#ffffff", weight: 850, anchor: "middle" })}
        ${textBlock(["起点元素"], 638, 250, { size: 22, fill: colors.ink, weight: 820 })}
        ${textBlock(["目标元素"], 950, 438, { size: 22, fill: colors.ink, weight: 820 })}
      </g>`
    )
  },
  {
    name: "screenshot-04-export-import-1280x800",
    width: 1280,
    height: 800,
    content: screenshotBase(
      ["复制 Markdown，", "交给 AI 直接修改"],
      ["URL、selector、XPath、评论，", "一次带齐。"],
      `<g filter="url(#shadow)">
        <rect x="520" y="72" width="686" height="596" rx="24" fill="#f8fafc"/>
        <rect x="560" y="126" width="606" height="284" rx="18" fill="#0b1120"/>
        ${textBlock(["## 页面反馈"], 594, 174, { size: 25, fill: "#7dd3fc", weight: 850, family: "ui-monospace, SFMono-Regular, Menlo, monospace" })}
        ${textBlock(["URL: https://app.example.com/pricing", "1. selector: main .pricing-card button", "XPath: /html/body/main/section[2]/button", "评论: CTA 与说明文字距离过近，需增加 16px。"], 594, 224, { size: 19, fill: "#dbeafe", weight: 650, lineHeight: 1.58, family: "ui-monospace, SFMono-Regular, Menlo, monospace" })}
        <rect x="560" y="450" width="286" height="142" rx="18" fill="#ffffff" stroke="${colors.line}"/>
        ${textBlock(["粘贴导入"], 590, 496, { size: 24, fill: colors.ink, weight: 850 })}
        ${textBlock(["别人复制来的反馈，", "可以复现原页面点位。"], 590, 536, { size: 17, fill: colors.muted, weight: 600, lineHeight: 1.36 })}
        <rect x="880" y="450" width="286" height="142" rx="18" fill="#ffffff" stroke="${colors.line}"/>
        ${textBlock(["跨页面切换"], 910, 496, { size: 24, fill: colors.ink, weight: 850 })}
        ${textBlock(["打开原 URL 后，", "点击即可定位元素。"], 910, 536, { size: 17, fill: colors.muted, weight: 600, lineHeight: 1.36 })}
      </g>`
    )
  },
  {
    name: "screenshot-05-workflow-1280x800",
    width: 1280,
    height: 800,
    content: screenshotBase(
      ["审阅、AI、开发", "形成闭环"],
      ["反馈不丢上下文，", "修改后回到点位验收。"],
      `<g filter="url(#shadow)">
        <rect x="530" y="98" width="650" height="532" rx="28" fill="#ffffff"/>
        ${[
          ["1", "点选 DOM", "在页面上直接选择元素并评论", colors.brand2],
          ["2", "复制给 AI", "生成 Markdown 修改说明", colors.sky],
          ["3", "开发处理", "selector、位置和样式摘要都在", colors.orange],
          ["4", "回到页面验收", "按状态流转为已通过或仍有问题", colors.red]
        ]
          .map((item, i) => {
            const y = 152 + i * 112;
            return `<g>
              <circle cx="596" cy="${y}" r="28" fill="${item[3]}"/>
              ${textBlock([item[0]], 596, y + 9, { size: 24, fill: "#ffffff", weight: 850, anchor: "middle" })}
              ${textBlock([item[1]], 648, y - 6, { size: 26, fill: colors.ink, weight: 850 })}
              ${textBlock([item[2]], 648, y + 28, { size: 18, fill: colors.muted, weight: 600 })}
              ${i < 3 ? `<line x1="596" y1="${y + 35}" x2="596" y2="${y + 77}" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round"/>` : ""}
            </g>`;
          })
          .join("")}
      </g>`
    )
  }
];

for (const asset of assets) {
  const svgPath = join(outDir, `${asset.name}.svg`);
  const pngPath = join(outDir, `${asset.name}.png`);
  writeFileSync(svgPath, asset.content);
  execFileSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], { stdio: "ignore" });
  console.log(`${asset.name}.png ${asset.width}x${asset.height}`);
}
