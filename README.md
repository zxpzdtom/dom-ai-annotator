# DOM Review

Chrome Manifest V3 插件，用来在真实网页上选择 DOM 元素、记录 UI 反馈、测量元素间距，并导出给 AI 或开发使用的修改说明。

## 安装

- [Chrome 应用商店安装 DOM Review](https://chromewebstore.google.com/detail/dom-review/faogcffafdfmkemadffpldonjoabogcj)
- [GitHub 源码与开发版本](https://github.com/zxpzdtom/dom-ai-annotator)

安装后打开目标网页，点击浏览器工具栏中的 DOM Review 图标即可打开右侧面板。

## 功能

- 在页面上点击 DOM 元素并添加评论。
- 评论浮层支持 Codex 风格的紧凑样式调整面板，可修改文本颜色、背景、透明度、字体、字号、字重、行高、对齐、间距、边框、宽高、内外边距等。
- 记录 selector、XPath、元素摘要、位置、视口和关键样式。
- 右侧面板按状态管理反馈：待处理、已发送、已修改、仍有问题、已通过、不处理。
- 右侧面板可在已保存过标注的页面 URL 间切换。
- 支持编辑已有评论，编辑时会回到页面上的原始浮层。
- 页面标点按状态显示不同颜色，侧栏点击卡片会定位并高亮对应元素。
- 支持临时测量工具：按元素对测量距离，固定多组测量结果。
- 支持复制 Markdown 反馈给 AI；复制后待处理项会自动流转为已发送。
- 支持 WebMCP Site Tools；兼容的浏览器 Agent 可直接查询、编辑、更新状态、删除和定位当前页面的标注。
- 支持从复制出的 Markdown 粘贴导入标注；如果导入内容属于另一个 URL，会提示打开原页面。
- 选择元素时会自动保存局部快照，便于后续在侧栏中查看视觉上下文。
- 提供 AI Debug DevTools 面板，用于查看可疑事件、Console、Network 和可编辑检测规则。

## 技术栈

- React
- TypeScript
- Tailwind CSS
- Vite
- Chrome Side Panel API

## 开发

```bash
npm install
npm run build
```

在 Chrome 中加载生成的 `dist` 文件夹：

1. 打开 `chrome://extensions`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `dist` 目录。
5. 打开任意页面并点击插件图标。

## WebMCP Site Tools

DOM Review 在当前页面启用后，会在浏览器支持 `document.modelContext` 时直接注册 WebMCP 工具。扩展自身没有远程 MCP URL，也不需要用户运行项目里的 `server.js`。旧版 Chrome 会跳过工具注册，页面标注和 Markdown 导出等原有功能不受影响。

可用工具：

- `dom_review_list_annotations`：默认列出当前页面标注，也可显式查询其他页面。
- `dom_review_get_annotation`：按稳定 ID 读取一条标注。
- `dom_review_get_annotation_snapshot`：读取快照元数据；仅在显式传入 `include_data_url: true` 时返回 Base64 Data URL。
- `dom_review_update_annotation`：编辑反馈、标题或状态。
- `dom_review_set_annotation_status`：设置任意现有状态。
- `dom_review_delete_annotation`：删除一条标注。
- `dom_review_focus_annotation`：在当前页面定位并高亮元素。
- `dom_review_show_annotation_snapshot`：把快照显示在当前页面，供 Agent 直接视觉检查，不把 Base64 放入工具结果。
- `dom_review_hide_annotation_snapshot`：完成视觉检查后关闭页面内的快照预览。

标注列表和详情默认不携带本地截图，避免把大段 Data URL 放入 Agent 上下文。需要原始图片数据时可通过快照工具显式获取；通常应优先使用页面预览工具。WebMCP 工具与当前标签页绑定，关闭页面后不再可用。

## Codex 插件（推荐）

外部 Chrome 页面注册的 WebMCP 工具不会自动进入 Codex 的工具列表。仓库因此提供了一个 Codex 插件，使用 Google 官方 [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) 连接用户当前的 Chrome，再通过 `list_webmcp_tools` 和 `execute_webmcp_tool` 调用 DOM Review。DOM Review 仍然只实现页面端 WebMCP，不维护自定义 MCP 服务。

环境要求：

- Chrome 150 或更新版本，并启用 `chrome://flags/#enable-webmcp-testing` 后重启。
- Node.js 20.19 或更新版本；Codex 插件会自动启动依赖，用户不需要手动运行 JS 文件。
- 在 `chrome://inspect/#remote-debugging` 开启 Remote Debugging；首次连接时在 Chrome 弹窗中点击“允许”。

在 Codex 中安装：

```bash
codex plugin marketplace add zxpzdtom/dom-ai-annotator
codex plugin add dom-review@dom-review
```

安装后新建一个 Codex 任务，打开目标网页和 DOM Review 侧栏，再让 Codex 获取评论列表。插件只向 Codex 开放以下桥接工具：

- `list_pages`：找到已经打开的目标页面。
- `list_webmcp_tools`：确认该页面确实注册了 DOM Review 工具。
- `execute_webmcp_tool`：调用 `dom_review_*` 工具。
- `take_screenshot`：仅用于在 `dom_review_show_annotation_snapshot` 展示快照后把图像作为 MCP 图片内容交给模型，避免把 Base64 文本塞进上下文。

这套连接没有可部署成 URL 的远程服务：评论保存在用户本机 Chrome 扩展存储中，远程 MCP 无法直接读取。官方桥接进程由 Codex 自动管理，连接的也是用户当前 Chrome，因此扩展、登录态和已有评论都能保留。

## Codex Skill

仓库内提供了 [`dom-review` Skill](./.agents/skills/dom-review/SKILL.md)，用于让 AI 理解插件安装、标注读取、代码修复、视觉复核和状态流转方式。

可以让 Codex 从 GitHub 安装：

```text
$skill-installer install the dom-review skill from https://github.com/zxpzdtom/dom-ai-annotator/tree/main/.agents/skills/dom-review
```

也可以将 `.agents/skills/dom-review` 目录复制到用户级的 `~/.agents/skills/dom-review`。Codex 通常会自动发现技能；如果没有显示，请重启 Codex。

Skill 会优先使用 Agent 直接暴露的 `dom_review_*` 网站工具；在 Codex 插件模式下，则只通过官方桥接的 `list_webmcp_tools` / `execute_webmcp_tool` 调用它们，不会用模拟点击侧栏代替 WebMCP。若页面没有暴露工具，Skill 会明确报告当前 WebMCP 未连接并停止实时标注操作。

## 使用流程

1. 打开右侧面板。
2. 点击“选择元素”或在页面中按 `C`。
3. 点击页面中的 DOM 元素。
4. 填写评论内容；需要细调时展开样式面板，直接输入数值或按住数值框上下拖动调整。
5. 在右侧面板管理状态、编辑评论或复制反馈。
6. 将复制出的 Markdown 发给 AI 或开发处理。
7. 其他人可在面板中“粘贴导入标注”复现点位。
8. 如果导入的标注属于其他 URL，可通过面板提示打开原页面，或用页面下拉切换查看。

## 快捷键

- 页面中按 `C`：进入选择元素模式。
- 页面中按 `M`：进入或继续测量距离。
- 测量中按 `Esc`：退出测量模式。
- 评论弹框中 `Enter`：保存。
- 评论弹框中 `Cmd/Ctrl + Enter`：保存。
- 评论弹框中 `Esc`：取消。
- `Alt+Shift+C`：打开面板并进入选择元素模式。

输入框、文本域、选择框和 `contenteditable` 内不会触发页面级 `C` / `M` 快捷键。

## 导出内容

复制反馈时会生成 Markdown，包括：

- 页面 URL 和标题
- selector 和 XPath
- 元素摘要
- 元素位置和视口信息
- 优先级和当前状态
- 用户评论
- 关键样式摘要
- 通过样式面板保存的具体样式变更，例如 `font-size: 72px -> 80px`

导出内容不会包含截图，也不会附带完整 computed styles JSON。插件仍会在本地存储一份关键 computed style 快照，用于后续编辑时兜底展示。

## 快照

新增评论时，插件会在点击目标元素的瞬间截取该元素附近的局部快照。截图前会临时隐藏插件自己的浮层，避免把评论弹框、工具条或高亮遮罩截入图片。快照只保存在本地 Chrome storage 中，用于侧栏查看和复核，不会随 Markdown 导出。

如果目标元素滚动后位置变化，插件会优先使用实时 DOM 位置重新定位评论点；找不到元素时再回退到保存时的位置快照。

## 测量工具

测量工具是临时辅助，不会保存到标注数据中。

使用方式：

1. 点击“测量距离”或按 `M`。
2. 点击第一个元素作为起点。
3. 悬停其他元素查看实时距离。
4. 点击第二个元素固定这一组测量。
5. 继续点击新元素开始下一组测量。

同一组元素会使用同一种颜色。重复选择同一对元素不会重复添加测量线。

## 权限说明

插件使用以下权限：

- `storage`：保存本地标注。
- `sidePanel`：展示右侧面板。
- `tabs`：获取当前标签页 URL 和标题，用于把标注归属到对应页面。
- `activeTab` / `scripting`：用户主动打开面板或点击工具后，向当前页面按需注入内容脚本并定位标注。
- `webNavigation`：侧栏打开时监听当前标签页内 iframe 和 SPA 导航，确保嵌套页面延迟加载后仍能展示对应标注。
- `<all_urls>`：允许在普通网页和本地 file 页面使用标注能力；内容脚本仍然只在用户打开面板或点击工具后按需注入。

插件不申请 `clipboardRead` 或 `clipboardWrite`。导入标注采用手动粘贴；复制 Markdown 使用用户点击触发的浏览器剪贴板 API。

## 当前限制

- 标注按完整 URL 归属。侧栏可以切换查看不同 URL 的标注，但定位和编辑需要打开对应原页面。
- selector 可能随页面 DOM 变化失效；失效时编辑会使用保存时的快照信息兜底。
- 测量结果是临时工具状态，刷新页面或退出测量后不会保存。
- 快照只用于本地复核，不随 Markdown 导出；如果页面内容动态变化，旧快照不会自动重截。

## 后续方向

- 更完整的跨页面工作区视图，例如按域名、路径或项目分组。
- React Fiber / Vue 组件路径捕获。
- WebMCP 标注与本地代码仓库的项目映射。
- 导出到 GitHub Issues、Linear 或其他团队工作流。

## 版本记录

### 0.3.8

- 新增页面端 WebMCP 工具，支持查询、编辑、删除、定位标注和流转任意状态。
- 新增快照元数据、按需 Base64 数据，以及页面内快照展示/关闭工具。
- 新增 DOM Review Codex 插件，通过 Google 官方 Chrome DevTools MCP 连接用户现有 Chrome。
- 新增配套 Skill，指导 AI 严格通过 WebMCP 处理标注并同步验证状态。
- 修复评论输入框回车不提交，以及复制反馈后待处理项不流转为已发送的问题。

### 0.3.7

- 使用 Chrome 原生全局侧边栏行为处理工具栏切换、关闭、刷新与标签页切换。
- 移除可能与 Chrome 原生状态冲突的自定义侧边栏恢复逻辑。
- 打开标注来源页面后保持侧栏页面选择器与当前标签页同步。

### 0.3.6

- 修复插件图标打开/关闭侧边栏的切换逻辑，并确保侧边栏关闭时同步移除页面胶囊。
- 修复同页多个 iframe 的标注重复显示、刷新后丢失，以及编辑框受 iframe 边界裁剪的问题。
- 编辑已有标注时先滚动目标进入可视区，再在顶层页面展开评论框。
- 修复单个样式重置连带覆盖其他属性，以及文字颜色被误读为不可见边框颜色的问题。
- 统一侧边栏与页面胶囊的选择元素图标。

### 0.3.5

- 修复无界微应用的子 iframe 位于开放 Shadow DOM 中时，标注无法正确交接的问题。
- 优化页面内拖拽把手，统一为更轻量的六点样式。
- 修复点击 iframe 内标注时只滚动子文档、外层页面滚动容器不跟随，导致目标仍停留在可视区域外的问题。

### 0.3.4

- 修复 iframe 标注保存后侧栏页面选择、列表编号和样式保持问题。
- 标注弹框的选择器恢复为完整 DOM 路径，便于 AI 精确定位元素。
- 选中元素后评论框自动聚焦，减少输入前的额外点击。
- 样式编辑保存后会在刷新/重新注入时重新应用已保存变更。
- 样式数值控件中除透明度外统一按整数 px 调整。

### 0.3.3

- 新增组合评论：评论输入框内可插入多个对象 token，例如“把对象 1 按对象 2 的颜色修改”。
- 侧栏多选支持生成组合评论，并可点击引用对象 chip 在页面中定位高亮。
- 优化 Markdown 导出，去除默认隐藏编码块，保留可读的涉及对象上下文。
- 修复从可读 Markdown 导入时引用对象丢失的问题。
- 优化 GitHub 等动态页面刷新后的标注定位，优先校验元素摘要并回退 XPath/文本匹配。
- 评论输入框聚焦时阻止页面全局快捷键抢占输入，例如 GitHub 的 `s` 搜索。

### 0.3.2

- 修复 Chrome 侧栏关闭后，刷新页面时底部标注胶囊偶发重新出现的问题。
- 侧栏隐藏时停止自动注入、心跳和导航监听，只在侧栏真正可见时展示页面标注层。

### 0.3.1

- 移除默认全页面内容脚本注入，改为侧栏打开后按需注入，降低普通浏览页面性能影响。
- AI Debug 改为 DevTools 面板打开后才收集 Console/Network，并限制响应体采集规模。
- 标注数据继续持久化到本地存储，调试数据改用临时 session storage，不再挂到页面全局对象。
- 修复已有标注在首次进入页面时需要进入标注模式后才显示的问题。
- 侧栏关闭后再次刷新页面时，页面内标注点和工具胶囊默认不再展示；标注数据不会被清除。
- 优化多选复制、批量状态更新和大尺寸元素截图，降低复制多条标注时卡顿风险。

### 0.3.0

- 支持 iframe、微应用和无界容器中的标注定位、评论展示和页面上下文切换。
- 优化选择/测量模式在外壳页面和嵌套页面之间的 hover、点击和快捷键联动。
- 修复选择链接元素时触发页面跳转的问题。
- 统一 `Esc`、`C`、`M` 在多 frame 页面中的生效范围。
- 优化测量工具：测量中不再误删已固定比例尺，退出后仅可点击测量线或数值删除。
- 为侧栏反馈列表增加滚动遮罩效果。

### 0.2.1

- AI Debug 面板默认语言改为中文。
- 修复侧边栏按需注入内容脚本失败时无法开始标注的问题。
- 优化评论点定位，滚动和响应式布局变化后更稳定地跟随目标元素。
- 快照改为在点选元素时预先截取，并在截图前隐藏插件浮层，避免截到评论弹框。

### 0.2.0

- 新增侧边栏标注管理、状态流转、导入导出和测量工具。
