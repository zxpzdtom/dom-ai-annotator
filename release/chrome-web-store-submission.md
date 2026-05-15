# Chrome Web Store Submission Notes

## Package

- Extension zip: `/Users/tom/code/dom-ai-annotator/release/dom-ai-annotator-0.1.0.zip`
- Version: `0.1.0`

## Listing

- Name: `DOM Review`
- Short description:
  `点击网页 DOM 元素收集设计反馈，并导出给 AI 或开发使用的结构化修改说明。`
- Category: `Developer Tools`
- Language: `Chinese (Simplified)`

## Detailed Description

DOM Review 是一个 Chrome 侧边栏工具，用来在真实网页上选择 DOM 元素、记录 UI 反馈、测量元素间距，并导出给 AI 或开发使用的结构化修改说明。

主要能力：

- 在页面上点击 DOM 元素并添加评论。
- 自动记录 selector、XPath、元素摘要、位置、视口和关键样式。
- 在右侧面板按状态管理反馈：待处理、已发送、已修改、仍有问题、已通过、不处理。
- 点击标注卡片可回到页面点位并高亮对应元素。
- 支持临时测量工具：按元素对测量距离，固定多组测量结果。
- 支持复制 Markdown 反馈给 AI 或开发处理。
- 支持从 Markdown 粘贴导入标注，复现原页面点位。

适合产品、设计、前端开发和 AI 编程工作流使用，减少截图沟通中的上下文丢失。

## Assets

- Small promo tile: `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/promo-small-440x280.png`
- Marquee promo tile: `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/promo-marquee-1400x560.png`
- Screenshots:
  - `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/screenshot-01-select-1280x800.png`
  - `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/screenshot-02-panel-1280x800.png`
  - `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/screenshot-03-measure-1280x800.png`
  - `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/screenshot-04-export-import-1280x800.png`
  - `/Users/tom/code/dom-ai-annotator/promo-video/assets/chrome-store/screenshot-05-workflow-1280x800.png`
- Promo video: `/Users/tom/code/dom-ai-annotator/promo-video/renders/dom-ai-annotator-promo.mp4`

## Permission Justifications

- `storage`: 保存本地标注数据、页面 URL、评论、状态和样式摘要。
- `sidePanel`: 在 Chrome 侧边栏展示标注管理面板。
- `tabs`: 获取当前标签页 URL 和标题，用于把标注归属到对应页面。
- `activeTab`: 用户主动点击扩展后，与当前页面交互。
- `scripting`: 用户主动打开面板或点击工具后，在当前页面按需注入内容脚本，用于选择元素、定位标注和测量距离。
- `<all_urls>` host permission: 允许用户在任意普通网页和本地 file 页面进行 DOM 标注和测量。内容脚本仍然只在用户打开面板或点击工具后按需注入。

The extension does not request `clipboardRead` or `clipboardWrite`. Clipboard import is manual paste into the extension UI. Clipboard export is attempted only after the user clicks copy, using the browser Clipboard API.

## Privacy Practices

Data handling summary:

- The extension stores annotation data locally in Chrome storage.
- Annotation data may include page URL, page title, selector, XPath, element text summary, viewport position, selected style properties, user comments, status, and timestamps.
- The extension does not send data to an external server.
- The extension does not sell data.
- Clipboard export is attempted only after the user clicks copy.
- Clipboard import happens only after the user manually pastes Markdown into the extension UI.

Suggested privacy form answers:

- Does this extension collect user data? Choose according to Chrome's definition. If local-only extension data counts in the form, disclose:
  - Website content: selected DOM element summaries, selectors, XPath, and page metadata.
  - User activity: user-created annotations and status changes.
- Data use:
  - Single purpose: DOM annotation, UI review, measurement, and export.
  - Not used for advertising.
  - Not shared with third parties by the extension.
  - Not transferred off device by the extension.

## Review Notes

This extension is a local productivity tool for reviewing webpages. It runs only when the user opens the side panel or starts annotation/measurement. Data remains in local Chrome storage unless the user explicitly copies Markdown or manually exports it.
