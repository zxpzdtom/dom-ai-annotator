# Chrome Web Store Submission Notes

## Package

- Extension zip: `/Users/tom/code/dom-ai-annotator/release/dom-ai-annotator-0.3.4.zip`
- Version: `0.3.4`

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
- 选择元素时自动保存局部快照，帮助复核视觉上下文。
- AI Debug 面板可查看可疑事件、Console、Network 和自定义检测规则，默认使用中文界面。

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
- Store icon: `/Users/tom/code/dom-ai-annotator/public/icons/icon-128.png`

## Permission Justifications

- `storage`: 保存本地标注数据、页面 URL、评论、状态、局部快照和样式摘要。
- `sidePanel`: 在 Chrome 侧边栏展示标注管理面板。
- `tabs`: 获取当前标签页 URL 和标题，用于把标注归属到对应页面。
- `activeTab`: 用户主动点击扩展后，与当前页面交互。
- `scripting`: 用户主动打开面板或点击工具后，在当前页面按需注入内容脚本，用于选择元素、定位标注和测量距离。
- `webNavigation`: 侧栏打开时监听当前标签页中的 iframe 和 SPA 导航，在嵌套页面延迟加载后按需补充注入内容脚本并刷新标注显示。
- `<all_urls>` host permission: 允许用户在任意普通网页和本地 file 页面进行 DOM 标注和测量。内容脚本仍然只在用户打开面板或点击工具后按需注入。

The extension does not request `clipboardRead` or `clipboardWrite`. Clipboard import is manual paste into the extension UI. Clipboard export is attempted only after the user clicks copy, using the browser Clipboard API.

## Privacy Practices

Data handling summary:

- The extension stores annotation data locally in Chrome storage.
- Annotation data may include page URL, page title, selector, XPath, element text summary, viewport position, local element screenshots, selected style properties, user comments, status, and timestamps.
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

## 0.3.4 Review Notes

- Fixes iframe annotation workflows so saved iframe annotations select the matching page context in the side panel.
- Keeps annotation numbering consistent between page pins and the side panel when top-page and iframe annotations coexist.
- Persists confirmed style edits and reapplies saved style changes after page refresh or content script reinjection.
- Restores full DOM-path CSS selectors for annotations to improve AI/developer element targeting.
- Focuses the comment input automatically after selecting an element.
- Normalizes pixel-based style controls to integer px values while keeping opacity on decimal steps.

## 0.3.3 Review Notes

- Adds composite feedback comments that can reference multiple page elements in one comment, such as changing one element to match another element's color.
- Reference objects are stored locally with selector, XPath, element summary, position, viewport, and key style snapshots.
- Improves Markdown export/import for composite comments while keeping exported content readable for AI/developer workflows.
- Improves annotation relocation after dynamic pages such as GitHub rebuild DOM after refresh by validating live selector matches and falling back to XPath/text matching.
- Prevents page-level keyboard shortcuts from firing while typing in the in-page comment editor.

## 0.3.2 Review Notes

- Fixes an issue where the page annotation capsule could occasionally reappear after the Chrome side panel was closed and the page was refreshed.
- The page annotation layer is now exposed only while the side panel document is visible; automatic content injection, heartbeat, and navigation listeners stop when the side panel is hidden.
- Saved annotations remain in local Chrome storage and are not deleted when the side panel closes.

## 0.3.1 Review Notes

- Content scripts are no longer registered in `manifest.content_scripts`; they are injected on demand after the user opens the side panel or starts a tool.
- The page annotation layer is hidden by default after reload and becomes visible only while the side panel activates it. Saved annotations remain in local storage.
- AI Debug collection runs only from the DevTools panel path and stores debug events in temporary `chrome.storage.session`.
