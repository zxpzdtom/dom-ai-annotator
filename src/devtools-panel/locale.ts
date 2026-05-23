// ─── i18n: English + Chinese ─────────────────────────────────────────────────

export type Locale = "en" | "zh";

const LOCALE_STORAGE_KEY = "domAiLocale";

export async function getLocale(): Promise<Locale> {
  try {
    const data = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
    const stored = data[LOCALE_STORAGE_KEY];
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // fallback
  }
  return "en";
}

export async function saveLocale(locale: Locale): Promise<void> {
  await chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: locale });
}

// ─── Translation dictionary ──────────────────────────────────────────────────

const dict = {
  // Tabs
  "tab.suspicious": { en: "Suspicious", zh: "可疑事件" },
  "tab.console": { en: "Console", zh: "控制台" },
  "tab.network": { en: "Network", zh: "网络" },
  "tab.ignoreRules": { en: "Ignore Rules", zh: "忽略规则" },
  "tab.suspiciousRules": { en: "Suspicious Rules", zh: "检测规则" },

  // Toolbar
  "toolbar.unhandled": { en: "unhandled", zh: "未处理" },
  "toolbar.filter.placeholder": { en: "Filter by url, token, errorCode...", zh: "按 URL、token、错误码过滤..." },
  "toolbar.clear": { en: "Clear", zh: "清空" },

  // Footer
  "footer.visible": { en: "visible", zh: "可见" },
  "footer.selected": { en: "selected", zh: "已选" },
  "footer.estimatedSize": { en: "Estimated size", zh: "预计大小" },
  "footer.selectVisible": { en: "Select visible", zh: "全选可见" },
  "footer.clearSelection": { en: "Clear selection", zh: "取消选择" },
  "footer.copyForAi": { en: "Copy for AI", zh: "复制给 AI" },
  "footer.copied": { en: "Copied", zh: "已复制" },

  // Empty states
  "empty.suspicious": { en: "No suspicious items found", zh: "暂无可疑项" },
  "empty.console": { en: "No matching console messages", zh: "暂无匹配的控制台消息" },
  "empty.network": { en: "No matching network requests", zh: "暂无匹配的网络请求" },
  "empty.items": { en: "No matching items", zh: "暂无匹配项" },

  // Detail panel
  "detail.title": { en: "Details", zh: "详情" },
  "detail.selectItem": { en: "Select an item", zh: "选择一个条目" },
  "detail.general": { en: "General", zh: "基本信息" },
  "detail.requestHeaders": { en: "Request Headers", zh: "请求头" },
  "detail.payload": { en: "Payload", zh: "请求体" },
  "detail.responseHeaders": { en: "Response Headers", zh: "响应头" },
  "detail.response": { en: "Response", zh: "响应体" },
  "detail.message": { en: "Message", zh: "消息" },
  "detail.stack": { en: "Stack", zh: "堆栈" },

  // Table headers
  "table.level": { en: "Level", zh: "等级" },
  "table.message": { en: "Message", zh: "消息" },
  "table.source": { en: "Source", zh: "来源" },
  "table.count": { en: "Count", zh: "次数" },
  "table.time": { en: "Time", zh: "时间" },
  "table.name": { en: "Name", zh: "名称" },
  "table.status": { en: "Status", zh: "状态" },
  "table.type": { en: "Type", zh: "类型" },
  "table.method": { en: "Method", zh: "方法" },
  "table.reason": { en: "Reason", zh: "原因" },

  // Suspicious view section headers
  "suspicious.console": { en: "Console", zh: "控制台" },
  "suspicious.network": { en: "Network", zh: "网络" },

  // Ignore Rules Panel
  "ignoreRules.title": { en: "Ignore Rules", zh: "忽略规则" },
  "ignoreRules.desc": { en: "Events matching these rules are hidden from all views — Suspicious, Console, and Network tabs.", zh: "匹配这些规则的事件将从所有视图中隐藏 — 包括可疑事件、控制台和网络标签页。" },
  "ignoreRules.urlPatterns": { en: "Ignored URL Patterns", zh: "忽略的 URL 模式" },
  "ignoreRules.urlHint": { en: "Glob patterns matched against network request URLs. Use * for any segment, ** for any path.", zh: "使用 glob 模式匹配网络请求 URL。* 匹配任意片段，** 匹配任意路径。" },
  "ignoreRules.urlPlaceholder": { en: "e.g. */hot-update*, *analytics*, */health", zh: "例如 */hot-update*, *analytics*, */health" },
  "ignoreRules.consoleMessages": { en: "Ignored Console Messages", zh: "忽略的控制台消息" },
  "ignoreRules.consoleMsgHint": { en: "Substring patterns matched against console messages (case-insensitive).", zh: "对控制台消息进行子字符串匹配（不区分大小写）。" },
  "ignoreRules.consoleMsgPlaceholder": { en: "e.g. [HMR], DevTools failed, Download the React DevTools", zh: "例如 [HMR], DevTools failed, Download the React DevTools" },
  "ignoreRules.domains": { en: "Ignored Domains", zh: "忽略的域名" },
  "ignoreRules.domainsHint": { en: "Requests to these domains (and subdomains) will be hidden from all views.", zh: "来自这些域名（含子域名）的请求将从所有视图中隐藏。" },
  "ignoreRules.domainsPlaceholder": { en: "e.g. analytics.google.com, sentry.io, hotjar.com", zh: "例如 analytics.google.com, sentry.io, hotjar.com" },
  "ignoreRules.noUrlPatterns": { en: "No URL patterns configured", zh: "暂未配置 URL 模式" },
  "ignoreRules.noMsgPatterns": { en: "No message patterns configured", zh: "暂未配置消息模式" },
  "ignoreRules.noDomains": { en: "No domains configured", zh: "暂未配置域名" },
  "ignoreRules.add": { en: "Add", zh: "添加" },

  // Suspicious Rules Panel
  "suspiciousRules.title": { en: "Suspicious Rules", zh: "检测规则" },
  "suspiciousRules.desc": { en: "Rules that flag events as suspicious. All rules are fully editable — modify, disable, delete, or add your own.", zh: "用于标记可疑事件的规则。所有规则均可编辑 — 修改、禁用、删除或新增。" },
  "suspiciousRules.addRule": { en: "Add Rule", zh: "添加规则" },
  "suspiciousRules.resetToDefaults": { en: "Reset to Defaults", zh: "恢复默认" },
  "suspiciousRules.confirmReset": { en: "Click again to confirm", zh: "再次点击确认" },
  "suspiciousRules.allRules": { en: "All Rules", zh: "全部规则" },
  "suspiciousRules.active": { en: "active", zh: "启用" },
  "suspiciousRules.noRules": { en: "No rules configured. Click + Add Rule to create one.", zh: "暂无规则。点击 + 添加规则 来创建。" },
  "suspiciousRules.untitled": { en: "Untitled", zh: "未命名" },
  "suspiciousRules.editLabel": { en: "Label", zh: "名称" },
  "suspiciousRules.editDesc": { en: "Description", zh: "描述" },
  "suspiciousRules.editLabelPlaceholder": { en: "Rule name", zh: "规则名称" },
  "suspiciousRules.editDescPlaceholder": { en: "What does this rule detect?", zh: "这个规则检测什么？" },
  "suspiciousRules.save": { en: "Save", zh: "保存" },
  "suspiciousRules.cancel": { en: "Cancel", zh: "取消" },
  "suspiciousRules.confirmDelete": { en: "Confirm delete?", zh: "确认删除？" },
  "suspiciousRules.toastReset": { en: "Reset to default rules", zh: "已恢复默认规则" },
  "suspiciousRules.severity": { en: "Severity", zh: "严重程度" },
  "suspiciousRules.conditions": { en: "Conditions", zh: "匹配条件" },
  "suspiciousRules.addCondition": { en: "+ Condition", zh: "+ 条件" },
  "suspiciousRules.valuePlaceholder": { en: "Value to match", zh: "匹配值" },
  "suspiciousRules.existsHint": { en: "Field is non-empty (no value needed)", zh: "字段非空即匹配（无需填值）" },

  // Rule targets
  "target.console-message": { en: "Console Message", zh: "控制台消息" },
  "target.console-level": { en: "Console Level", zh: "控制台等级" },
  "target.url": { en: "URL", zh: "URL" },
  "target.status-code": { en: "HTTP Status", zh: "HTTP 状态码" },
  "target.response-body": { en: "Response Body", zh: "响应体" },
  "target.request-method": { en: "Request Method", zh: "请求方法" },
  "target.request-type": { en: "Request Type", zh: "请求类型" },
  "target.response-type": { en: "Response Type", zh: "响应类型" },
  "target.duration": { en: "Duration (ms)", zh: "耗时 (ms)" },
  "target.network-error": { en: "Network Error", zh: "网络错误" },

  // Rule operators
  "op.contains": { en: "contains", zh: "包含" },
  "op.not-contains": { en: "not contains", zh: "不包含" },
  "op.equals": { en: "equals", zh: "等于" },
  "op.not-equals": { en: "not equals", zh: "不等于" },
  "op.matches": { en: "matches (regex)", zh: "正则匹配" },
  "op.gte": { en: ">=", zh: ">=" },
  "op.lte": { en: "<=", zh: "<=" },
  "op.exists": { en: "exists", zh: "存在" },

  // Rule severity
  "severity.error": { en: "Error", zh: "错误" },
  "severity.warn": { en: "Warning", zh: "警告" },
  "severity.info": { en: "Info", zh: "信息" },

  // Language toggle
  "lang.toggle": { en: "中文", zh: "EN" },
  "lang.tooltip": { en: "Switch to Chinese", zh: "Switch to English" },
} as const;

export type TranslationKey = keyof typeof dict;

export function t(key: TranslationKey, locale: Locale): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[locale] || entry.en;
}
