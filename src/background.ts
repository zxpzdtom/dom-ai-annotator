import { isExcludedUrl } from "./shared/excludedUrls";
import type { RuntimeMessage } from "./shared/types";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void syncAllTabsSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void syncAllTabsSidePanel();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncTabSidePanel(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) void syncTabSidePanel(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void syncTabSidePanel(tabId, tab.url).then((enabled) => {
      if (enabled && changeInfo.status === "complete") void ensureTabMonitor(tabId);
    });
  }
});

chrome.tabs.onReplaced.addListener((addedTabId) => {
  void syncTabSidePanel(addedTabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const enabled = await syncTabSidePanel(tab.id, tab.url);
  if (!enabled) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const enabled = await syncTabSidePanel(tab.id, tab.url);
  if (!enabled) return;

  if (command === "start-picking") {
    await chrome.sidePanel.open({ tabId: tab.id });
    await sendContentMessage(tab.id, { type: "DOM_AI_START_PICKING" });
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === "DOM_AI_OPEN_SIDE_PANEL") {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? "";
    if (!tabId) return;
    void syncTabSidePanel(tabId, url).then((enabled) => {
      if (enabled) void chrome.sidePanel.open({ tabId });
    });
    return;
  }

  if (message.type === "DOM_AI_CAPTURE_SCREENSHOT") {
    const rect = (message as { rect?: { x: number; y: number; width: number; height: number } }).rect;
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ success: false, error: chrome.runtime.lastError?.message ?? "Capture failed" });
        return;
      }
      sendResponse({
        success: true,
        data: { dataUrl, capturedAt: new Date().toISOString(), visibleRect: rect || { x: 0, y: 0, width: 0, height: 0 } },
      });
    });
    return true; // async sendResponse
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function syncActiveTabSidePanel() {
  const tab = await getActiveTab();
  if (tab?.id) await syncTabSidePanel(tab.id, tab.url);
}

async function syncAllTabsSidePanel() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id ? syncTabSidePanel(tab.id, tab.url) : Promise.resolve(false))));
  await syncActiveTabSidePanel();
}

async function syncTabSidePanel(tabId: number, url?: string): Promise<boolean> {
  const resolvedUrl = url ?? (await chrome.tabs.get(tabId).catch(() => undefined))?.url ?? "";
  const enabled = !isExcludedUrl(resolvedUrl);

  if (!enabled) {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
    return false;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: "src/sidepanel/index.html",
    enabled: true
  });
  void ensureTabMonitor(tabId);
  void ensureAgentBridgeHost(tabId);
  return true;
}

async function sendContentMessage(tabId: number, message: unknown) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-loader.js"]
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

async function ensureTabMonitor(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["monitorBridge.js"],
      world: "MAIN"
    });
    await chrome.tabs.sendMessage(tabId, { type: "DOM_AI_MONITOR_ENABLE" });
  } catch {
    // Browser internal pages and restricted documents cannot be scripted.
  }
}

async function ensureAgentBridgeHost(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["agentBridgeHost.js"]
    });
  } catch {
    // Browser internal pages and restricted documents cannot be scripted.
  }
}
