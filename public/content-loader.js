(() => {
  const ROOT_ID = "dom-ai-loader-entry";
  const PANEL_ID = "dom-ai-loader-devtools";
  const BRIDGE_ID = "dom-ai-monitor-bridge-script";
  const JSON_VIEWER_ID = "dom-ai-json-viewer-vendor-script";
  if (document.getElementById(ROOT_ID)) return;

  const events = [];
  let selectedId = "";
  let activeView = "console";
  let activeDetailTab = "headers";
  let contextMenuEventId = "";
  let consoleFilter = "all";
  let networkFilter = "all";
  let sortKey = "";
  let sortDirection = "asc";
  let dragState = null;
  let jsonViewerLoading = false;

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.cssText = "all:initial;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;pointer-events:auto!important;display:block!important;visibility:visible!important;opacity:1!important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "DOM Review";
  button.style.cssText = "all:initial;display:inline-flex!important;height:38px!important;align-items:center!important;border:0!important;border-radius:999px!important;background:#202124!important;color:white!important;box-shadow:0 12px 32px rgba(32,33,36,.28)!important;padding:0 14px!important;font:700 13px Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;cursor:pointer!important;pointer-events:auto!important";

  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.style.cssText = "all:initial;display:none;position:fixed!important;right:12px!important;bottom:12px!important;width:min(1180px,calc(100vw - 24px))!important;height:min(760px,calc(100vh - 24px))!important;z-index:2147483647!important;background:white!important;border:1px solid #cbd5e1!important;border-radius:8px!important;box-shadow:0 24px 80px rgba(15,23,42,.28)!important;color:#202124!important;font:13px Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;overflow:hidden!important;pointer-events:auto!important";

  panel.innerHTML = `
    <style>
      #${PANEL_ID} *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      #${PANEL_ID} button{font:inherit;cursor:pointer}
      .dai-tabs{display:flex;align-items:center;height:38px;background:#edf3fb;border-bottom:1px solid #cbd5e1;padding:0 8px;gap:4px;cursor:move;user-select:none}
      .dai-tab{height:38px;border:0;border-bottom:2px solid transparent;background:transparent;color:#3c4043;padding:0 10px;font-weight:650}
      .dai-tab.active{border-color:#1a73e8;color:#0b57d0}
      .dai-close{margin-left:auto;width:30px;height:30px;border:0;border-radius:5px;background:transparent;font-size:20px;color:#5f6368}
      .dai-toolbar{height:38px;display:flex;align-items:center;gap:7px;background:#f8fbff;border-bottom:1px solid #dbe3ef;padding:5px 8px}
      .dai-icon{width:28px;height:28px;border:0;border-radius:5px;background:transparent;color:#4b5563}
      .dai-icon:hover,.dai-close:hover{background:rgba(15,23,42,.08)}
      .dai-filter{display:flex;align-items:center;gap:6px;min-width:180px;max-width:520px;flex:1;border-radius:999px;background:#eaf0f8;padding:5px 10px;color:#5f6368}.dai-console-filters,.dai-network-filters{display:flex;gap:4px;overflow-x:auto;max-width:520px}.dai-chip{height:26px;border:1px solid #cbd5e1;border-radius:999px;background:white;color:#3c4043;padding:0 9px;font-weight:650}.dai-chip.active{background:#dbeafe;border-color:#93c5fd;color:#0b57d0}
      .dai-filter input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#202124;font:inherit}
      .dai-body{height:calc(100% - 76px);display:flex;overflow:hidden;background:white}
      .dai-list{min-width:0;flex:1;overflow:auto}
      .dai-empty{padding:32px;text-align:center;color:#7b8494;font-weight:650}
      .dai-console-row{display:grid;grid-template-columns:24px minmax(0,1fr);gap:4px;width:100%;border:0;border-bottom:1px solid #edf0f4;background:white;padding:5px 10px;text-align:left;font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:18px;color:#202124}
      .dai-console-row.warn{background:#fff8df}.dai-console-row.error{background:#fff0f0}.dai-console-row.selected{background:#dfe7f3!important}
      .dai-console-row pre{grid-column:2;margin:0;color:#5f6368;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
      .dai-net-head,.dai-net-row{display:grid;grid-template-columns:minmax(230px,1.7fr) 78px 150px 82px 78px;min-width:720px}
      .dai-net-head{position:sticky;top:0;height:31px;background:#f6f8fb;border-bottom:1px solid #cbd5e1;color:#3c4043;font-size:12px;font-weight:700;z-index:1}
      .dai-net-head span,.dai-net-row span{overflow:hidden;border-right:1px solid #edf0f4;padding:6px 8px;text-overflow:ellipsis;white-space:nowrap}.dai-net-head span{cursor:pointer;user-select:none}.dai-net-head span:hover{background:#eaf0f8}
      .dai-net-row{display:grid;grid-template-columns:minmax(230px,1.7fr) 78px 150px 82px 78px;min-width:720px;width:100%;height:31px;border:0;border-bottom:1px solid #f1f5f9;background:white;color:#202124;text-align:left;font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;user-select:text}
      .dai-net-row:nth-child(odd){background:#f8fafc}.dai-net-row:hover,.dai-net-row.selected{background:#dfe7f3}.dai-net-row span{user-select:text}.bad{color:#d93025;font-weight:700}
      .dai-detail{width:min(480px,42%);min-width:360px;border-left:1px solid #cbd5e1;background:white;overflow:auto}.dai-menu{position:fixed;z-index:2147483647;min-width:190px;border:1px solid #cbd5e1;border-radius:8px;background:white;box-shadow:0 16px 44px rgba(15,23,42,.18);padding:5px;display:none}.dai-menu button{display:block;width:100%;border:0;border-radius:6px;background:white;color:#202124;text-align:left;padding:8px 10px;font:13px Inter,ui-sans-serif,system-ui}.dai-menu button:hover{background:#edf2fb}.dai-menu button[disabled]{color:#9ca3af;background:white;cursor:not-allowed}
      .dai-detail-tabs{height:36px;display:flex;gap:14px;border-bottom:1px solid #dbe3ef;background:#f6f8fb;padding:0 12px}
      .dai-detail-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:0 0 0;font-weight:700;color:#3c4043}.dai-detail-tabs button.active{border-color:#1a73e8;color:#0b57d0}.dai-detail-close{width:24px!important;font-size:18px!important;color:#5f6368!important;border-bottom:0!important}.dai-detail-close:hover{background:#edf2fb!important;border-radius:4px}
      .dai-detail-body{padding:10px 12px;font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:18px;color:#202124}
      .dai-block{position:relative;margin-bottom:14px}.dai-block h3{margin:0 0 6px;font:700 13px Inter,ui-sans-serif,system-ui;color:#202124}.dai-block p{margin:0 0 3px;overflow-wrap:anywhere}.dai-block b{color:#9c27b0}.dai-copy-block{position:absolute;right:6px;top:0;height:24px;border:1px solid #cbd5e1;border-radius:6px;background:white;color:#3c4043;padding:0 7px;font:12px Inter,ui-sans-serif,system-ui}.dai-copy-block:hover{background:#edf2fb}.dai-block pre{max-height:none;overflow:visible;border-radius:6px;background:#f8fafc;margin:0;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}.dai-json-tree,.dai-npm-json-viewer{border-radius:6px;background:#f8fafc;padding:8px;overflow:visible;max-height:none;font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:21px}.dai-json-line{min-height:19px;white-space:nowrap}.dai-json-node{margin-left:16px;border-left:1px solid #e2e8f0;padding-left:8px}.dai-json-toggle{display:inline-flex;min-width:28px;height:22px;align-items:center;border:0;background:transparent;color:#5f6368;padding:0 6px 0 0;font:inherit;text-align:left}.dai-json-line{cursor:pointer;border-radius:4px}.dai-json-line:hover{background:#eef2f7}.dai-json-leaf{display:inline-block;width:16px}.dai-json-key{color:#9c27b0}.dai-json-string{color:#188038}.dai-json-number,.dai-json-boolean{color:#1967d2}.dai-json-null{color:#5f6368}.dai-json-meta{color:#6b7280}.dai-json-hidden{display:none}.dai-npm-json-viewer .jsoneditor{height:auto!important;min-height:36px!important;border:0!important;background:transparent!important;line-height:normal!important}.dai-npm-json-viewer .jsoneditor-outer,.dai-npm-json-viewer .jsoneditor-tree{height:auto!important;overflow:visible!important;background:transparent!important}.dai-npm-json-viewer table.jsoneditor-tree{width:100%!important}.dai-npm-json-viewer .jsoneditor-menu,.dai-npm-json-viewer .jsoneditor-navigation-bar,.dai-npm-json-viewer .jsoneditor-statusbar{display:none!important}.dai-npm-json-viewer div.jsoneditor-field,.dai-npm-json-viewer div.jsoneditor-value,.dai-npm-json-viewer div.jsoneditor-readonly,.dai-npm-json-viewer div.jsoneditor-default{font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace!important;line-height:18px!important;min-height:18px!important;padding:1px 2px!important;margin:0!important;border:0!important;float:left!important}.dai-npm-json-viewer div.jsoneditor-field{color:#9c27b0!important}.dai-npm-json-viewer div.jsoneditor-value.jsoneditor-string{color:#188038!important}.dai-npm-json-viewer div.jsoneditor-value.jsoneditor-number,.dai-npm-json-viewer div.jsoneditor-value.jsoneditor-boolean{color:#1967d2!important}.dai-npm-json-viewer div.jsoneditor-value.jsoneditor-null{color:#5f6368!important}.dai-npm-json-viewer div.jsoneditor-tree button.jsoneditor-button{width:22px!important;height:22px!important;background-image:none!important;color:#5f6368!important;font:700 13px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace!important}.dai-npm-json-viewer button.jsoneditor-expanded:before{content:"▾"}.dai-npm-json-viewer button.jsoneditor-collapsed:before{content:"▸"}.dai-npm-json-viewer button.jsoneditor-invisible:before{content:""}.dai-npm-json-viewer button.jsoneditor-dragarea,.dai-npm-json-viewer button.jsoneditor-contextmenu-button{display:none!important}.dai-preview-image,.dai-preview-video{display:block;max-width:100%;max-height:520px;border-radius:6px;background:#111827;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1);object-fit:contain}.dai-preview-audio{display:block;width:100%;margin-top:8px}
    </style>
    <div class="dai-tabs"><button class="dai-tab active" data-view="console">Console <span data-console-count>0</span></button><button class="dai-tab" data-view="network">Network <span data-network-count>0</span></button><button class="dai-close" title="Close">×</button></div>
    <div class="dai-toolbar"><button class="dai-icon" data-clear title="Clear">⊘</button><button class="dai-icon" data-copy title="Copy selected">⧉</button><div class="dai-console-filters"><button class="dai-chip active" data-console-filter="all">All</button><button class="dai-chip" data-console-filter="error">Errors</button><button class="dai-chip" data-console-filter="warn">Warnings</button><button class="dai-chip" data-console-filter="info">Info</button><button class="dai-chip" data-console-filter="log">Logs</button></div><div class="dai-network-filters" style="display:none"><button class="dai-chip active" data-network-filter="all">All</button><button class="dai-chip" data-network-filter="fetch-xhr">Fetch/XHR</button><button class="dai-chip" data-network-filter="doc">Doc</button><button class="dai-chip" data-network-filter="css">CSS</button><button class="dai-chip" data-network-filter="js">JS</button><button class="dai-chip" data-network-filter="img">Img</button><button class="dai-chip" data-network-filter="font">Font</button><button class="dai-chip" data-network-filter="media">Media</button><button class="dai-chip" data-network-filter="ws">WS</button><button class="dai-chip" data-network-filter="other">Other</button></div><div class="dai-filter">Filter <input data-filter placeholder="Filter"></div><span data-count>0 visible</span></div>
    <div class="dai-body"><div class="dai-list"></div><aside class="dai-detail" style="display:none"></aside></div><div class="dai-menu"><button data-copy-curl>Copy as cURL</button><button data-copy-fetch>Copy as fetch</button><button data-copy-url>Copy URL</button><button data-copy-response>Copy response</button><button disabled>Override response...</button></div>
  `;

  function showPanel() {
    panel.style.display = "block";
    injectJsonViewer();
    if (!panel.dataset.positioned) {
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(12, window.innerWidth - rect.width - 12)}px`;
      panel.style.top = `${Math.max(12, window.innerHeight - rect.height - 12)}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.dataset.positioned = "true";
    }
    root.style.display = "none";
    render();
  }

  function hidePanel() {
    panel.style.display = "none";
    root.style.display = "block";
  }

  function injectBridge() {
    try {
      if (document.getElementById(BRIDGE_ID)) return;
      const script = document.createElement("script");
      script.id = BRIDGE_ID;
      script.src = chrome.runtime.getURL("monitorBridge.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).append(script);
    } catch (error) {
      console.warn("DOM Review monitor bridge failed", error);
    }
  }

  function injectJsonViewer() {
    try {
      if (window.DOM_AI_JsonViewer || jsonViewerLoading || document.getElementById(JSON_VIEWER_ID)) return;
      jsonViewerLoading = true;
      const script = document.createElement("script");
      script.id = JSON_VIEWER_ID;
      script.src = chrome.runtime.getURL("jsonViewerVendor.js");
      script.onload = () => {
        jsonViewerLoading = false;
        render();
      };
      script.onerror = () => {
        jsonViewerLoading = false;
      };
      (document.head || document.documentElement).append(script);
    } catch (error) {
      jsonViewerLoading = false;
      console.warn("DOM Review JSON viewer failed", error);
    }
  }

  function render() {
    const query = panel.querySelector("[data-filter]").value.trim().toLowerCase();
    const visible = events.filter((event) => activeView === "network" ? event.kind === "network" && matchesNetworkFilter(event) : event.kind !== "network" && matchesConsoleFilter(event)).filter((event) => !query || JSON.stringify(event).toLowerCase().includes(query));
    panel.querySelector(".dai-console-filters").style.display = activeView === "console" ? "flex" : "none";
    panel.querySelector(".dai-network-filters").style.display = activeView === "network" ? "flex" : "none";
    panel.querySelectorAll("[data-console-filter]").forEach((chip) => chip.classList.toggle("active", chip.dataset.consoleFilter === consoleFilter));
    panel.querySelectorAll("[data-network-filter]").forEach((chip) => chip.classList.toggle("active", chip.dataset.networkFilter === networkFilter));
    panel.querySelector("[data-console-count]").textContent = String(events.filter((event) => event.kind !== "network").length);
    panel.querySelector("[data-network-count]").textContent = String(events.filter((event) => event.kind === "network").length);
    panel.querySelector("[data-count]").textContent = `${visible.length} visible`;
    panel.querySelectorAll(".dai-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === activeView));
    if (activeView === "network" && visible.length && !visible.some((event) => event.id === selectedId)) {
      selectedId = visible[0].id;
    }
    const list = panel.querySelector(".dai-list");
    const detail = panel.querySelector(".dai-detail");
    detail.style.display = "none";
    detail.innerHTML = "";
    if (!visible.length) {
      list.innerHTML = `<div class="dai-empty">No ${activeView === "network" ? "network requests" : "console messages"}</div>`;
      return;
    }
    if (activeView === "network") {
      activeDetailTab = activeDetailTab || "preview";
      const sortedVisible = sortNetworkEvents(visible);
      list.innerHTML = `<div class="dai-net-head"><span data-sort="name">Name${sortMark("name")}</span><span data-sort="status">Status${sortMark("status")}</span><span data-sort="type">Type${sortMark("type")}</span><span data-sort="method">Method${sortMark("method")}</span><span data-sort="time">Time${sortMark("time")}</span></div>` + sortedVisible.map((event) => `<div class="dai-net-row ${event.id === selectedId ? "selected" : ""}" data-id="${escapeHtml(event.id)}"><span>${escapeHtml(networkName(event.message))}</span><span class="${event.ok === false ? "bad" : ""}">${escapeHtml(String(event.status ?? "failed"))}</span><span>${escapeHtml(event.responseType || event.requestType || "fetch")}</span><span>${escapeHtml(event.method || "GET")}</span><span>${escapeHtml(String(event.durationMs ?? 0))} ms</span></div>`).join("");
      const selected = sortedVisible.find((event) => event.id === selectedId);
      if (selected) renderDetail(selected);
    } else {
      list.innerHTML = visible.map((event) => `<button class="dai-console-row ${tone(event)} ${event.id === selectedId ? "selected" : ""}" data-id="${escapeHtml(event.id)}"><span>${tone(event) === "info" ? "›" : "⚠"}</span><code>${escapeHtml(event.message)}</code>${event.details || event.stack ? `<pre>${escapeHtml(event.details || event.stack)}</pre>` : ""}</button>`).join("");
    }
  }

  function sortNetworkEvents(items) {
    if (!sortKey) return items;
    const sorted = [...items].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }

  function getSortValue(event, key) {
    if (key === "name") return networkName(event.message);
    if (key === "status") return Number(event.status ?? -1);
    if (key === "type") return event.responseType || event.requestType || "";
    if (key === "method") return event.method || "";
    if (key === "time") return Number(event.durationMs ?? 0);
    return "";
  }

  function sortMark(key) {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  }

  function cycleSort(key) {
    if (sortKey !== key) { sortKey = key; sortDirection = "asc"; return; }
    if (sortDirection === "asc") { sortDirection = "desc"; return; }
    sortKey = ""; sortDirection = "asc";
  }

  function renderDetail(event) {
    const detail = panel.querySelector(".dai-detail");
    detail.style.display = "block";
    const tabs = ["headers", "preview", "response", "payload"];
    detail.innerHTML = `<div class="dai-detail-tabs"><button class="dai-detail-close" data-close-detail title="Close details">×</button>${tabs.map((tab) => `<button class="${activeDetailTab === tab ? "active" : ""}" data-detail-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join("")}</div><div class="dai-detail-body">${renderDetailBody(event)}</div>`;
    hydrateJsonViewers(detail);
  }

  function renderDetailBody(event) {
    if (activeDetailTab === "headers") {
      return block("General", {"Request URL": event.message.replace(/^\S+\s+/, ""), "Request Method": event.method || "GET", "Status Code": event.status ? `${event.status} ${event.statusText || ""}` : "failed", Duration: `${event.durationMs ?? 0} ms`}) + block("Request Headers", event.requestHeaders || {}) + block("Response Headers", event.responseHeaders || {});
    }
    if (activeDetailTab === "payload") return textBlock("Payload", event.requestBody) || `<div class="dai-empty">No request payload</div>`;
    if (activeDetailTab === "response") return responseBlock("Response", event.responseBody, false) || `<div class="dai-empty">No response body captured</div>`;
    return responseBlock("Preview", event.responseBody || getPreviewUrl(event), true) || block("Preview", { status: String(event.status ?? "failed"), type: event.responseType || event.requestType || "fetch", duration: `${event.durationMs ?? 0} ms` });
  }

  function block(title, rows) {
    const entries = Object.entries(rows || {});
    if (!entries.length) return "";
    return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${entries.map(([key, value]) => `<p><b>${escapeHtml(key)}:</b> <span>${escapeHtml(String(value))}</span></p>`).join("")}</section>`;
  }

  function textBlock(title, value) {
    if (!value) return "";
    return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${copyButton(value)}<pre>${escapeHtml(formatJson(value))}</pre></section>`;
  }

  function responseBlock(title, value, treePreview = false) {
    if (!value) return "";
    if (isImagePreviewUrl(value)) return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${copyButton(value)}<img class="dai-preview-image" src="${escapeHtml(value)}" alt="Response image preview"></section>`;
    if (isVideoPreviewUrl(value)) return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${copyButton(value)}<video class="dai-preview-video" src="${escapeHtml(value)}" controls preload="metadata"></video></section>`;
    if (isAudioPreviewUrl(value)) return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${copyButton(value)}<audio class="dai-preview-audio" src="${escapeHtml(value)}" controls preload="metadata"></audio></section>`;
    if (treePreview) {
      const tree = jsonTreeBlock(title, value);
      if (tree) return tree;
    }
    return textBlock(title, value);
  }

  function matchesNetworkFilter(event) {
    if (networkFilter === "all") return true;
    const type = String(event.responseType || event.requestType || "").toLowerCase();
    const url = String(event.message || "").replace(/^\S+\s+/, "").toLowerCase();
    if (networkFilter === "fetch-xhr") return event.requestType === "fetch" || event.requestType === "xhr" || event.requestType === "beacon";
    if (networkFilter === "doc") return type.includes("html") || /\.html?(?:[?#]|$)/.test(url);
    if (networkFilter === "css") return type.includes("css") || /\.css(?:[?#]|$)/.test(url);
    if (networkFilter === "js") return type.includes("javascript") || type === "script" || /\.(m?js|jsx|ts|tsx)(?:[?#]|$)/.test(url);
    if (networkFilter === "img") return type.startsWith("image/") || type === "img" || /\.(png|jpe?g|gif|webp|svg|ico|avif)(?:[?#]|$)/.test(url);
    if (networkFilter === "font") return type.includes("font") || /\.(woff2?|ttf|otf|eot)(?:[?#]|$)/.test(url);
    if (networkFilter === "media") return type.startsWith("audio/") || type.startsWith("video/") || /\.(mp4|webm|mp3|wav|ogg|mov)(?:[?#]|$)/.test(url);
    if (networkFilter === "ws") return event.requestType === "websocket";
    return !["fetch-xhr", "doc", "css", "js", "img", "font", "media", "ws"].some((filter) => { const previous = networkFilter; networkFilter = filter; const matched = matchesNetworkFilter(event); networkFilter = previous; return matched; });
  }

  function matchesConsoleFilter(event) {
    if (consoleFilter === "all") return true;
    if (consoleFilter === "error") return event.severity === "error" || event.kind === "error";
    if (consoleFilter === "warn") return event.severity === "warn";
    if (consoleFilter === "info") return event.severity === "info";
    if (consoleFilter === "log") return event.severity === "log";
    return true;
  }

  function tone(event) {
    if (event.severity === "error" || event.kind === "error" || event.ok === false) return "error";
    if (event.severity === "warn") return "warn";
    return "info";
  }

  function networkName(message) {
    const url = String(message || "").replace(/^\S+\s+/, "");
    try {
      const parsed = new URL(url);
      return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    } catch {
      return url;
    }
  }

  function jsonTreeBlock(title, value) {
    try {
      const parsed = JSON.parse(value);
      if (window.DOM_AI_JsonViewer) {
        const id = `json-viewer-${Math.random().toString(36).slice(2)}`;
        return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${copyButton(value)}<div id="${id}" class="dai-npm-json-viewer" data-json-viewer="${escapeHtml(encodeURIComponent(value))}"></div></section>`;
      }
      injectJsonViewer();
      return `<section class="dai-block"><h3>${escapeHtml(title)}</h3>${copyButton(value)}<div class="dai-json-tree">${renderJsonNode(parsed, "root", true)}</div></section>`;
    } catch {
      return "";
    }
  }

  function hydrateJsonViewers(container) {
    const Viewer = window.DOM_AI_JsonViewer;
    if (!Viewer) return;
    container.querySelectorAll("[data-json-viewer]").forEach((target) => {
      const data = decodeURIComponent(target.dataset.jsonViewer || "");
      target.removeAttribute("data-json-viewer");
      target.innerHTML = "";
      try {
        new Viewer({ container: target, data, theme: "light", expand: true });
      } catch {
        target.textContent = formatJson(data);
      }
    });
  }

  function renderJsonNode(value, key, expanded) {
    const hasKey = key !== "root";
    const displayKey = hasKey ? (key === "" ? "(empty)" : key) : "";
    const keyHtml = hasKey ? `<span class="dai-json-key">${escapeHtml(JSON.stringify(displayKey))}</span>: ` : "";
    if (value === null) return `<div class="dai-json-line"><span class="dai-json-leaf"></span>${keyHtml}<span class="dai-json-null">null</span></div>`;
    if (typeof value === "string") return `<div class="dai-json-line"><span class="dai-json-leaf"></span>${keyHtml}<span class="dai-json-string">${escapeHtml(JSON.stringify(value))}</span></div>`;
    if (typeof value === "number") return `<div class="dai-json-line"><span class="dai-json-leaf"></span>${keyHtml}<span class="dai-json-number">${value}</span></div>`;
    if (typeof value === "boolean") return `<div class="dai-json-line"><span class="dai-json-leaf"></span>${keyHtml}<span class="dai-json-boolean">${value}</span></div>`;
    if (Array.isArray(value)) {
      const id = `json-${Math.random().toString(36).slice(2)}`;
      const children = value.map((item, index) => renderJsonNode(item, String(index), false)).join("");
      return `<div><div class="dai-json-line" data-json-line="${id}"><button class="dai-json-toggle" data-json-toggle="${id}">${expanded ? "▾" : "▸"}</button>${keyHtml}<span class="dai-json-meta">${hasKey ? "" : "root: "}Array(${value.length})</span></div><div id="${id}" class="dai-json-node ${expanded ? "" : "dai-json-hidden"}">${children}</div></div>`;
    }
    if (typeof value === "object") {
      const id = `json-${Math.random().toString(36).slice(2)}`;
      const entries = Object.entries(value);
      const children = entries.map(([childKey, childValue]) => renderJsonNode(childValue, childKey, false)).join("");
      return `<div><div class="dai-json-line" data-json-line="${id}"><button class="dai-json-toggle" data-json-toggle="${id}">${expanded ? "▾" : "▸"}</button>${keyHtml}<span class="dai-json-meta">${hasKey ? "" : "root: "}Object(${entries.length})</span></div><div id="${id}" class="dai-json-node ${expanded ? "" : "dai-json-hidden"}">${children}</div></div>`;
    }
    return `<div class="dai-json-line"><span class="dai-json-leaf"></span>${keyHtml}${escapeHtml(String(value))}</div>`;
  }

  function copyButton(value) {
    return `<button class="dai-copy-block" data-copy-block="${escapeHtml(encodeURIComponent(String(value)))}">Copy</button>`;
  }

  function getPreviewUrl(event) {
    const type = String(event.responseType || event.requestType || "").toLowerCase();
    const url = String(event.message || "").replace(/^\S+\s+/, "");
    if (isLikelyImage(type, url) || isLikelyVideo(type, url) || isLikelyAudio(type, url)) return url;
    return "";
  }

  function isLikelyImage(type, url) {
    return type.startsWith("image/") || type === "img" || /\.(png|jpe?g|gif|webp|svg|ico|avif)(?:[?#]|$)/i.test(url);
  }

  function isLikelyVideo(type, url) {
    return type.startsWith("video/") || /\.(webm|mp4|mov|m4v|ogv)(?:[?#]|$)/i.test(url);
  }

  function isLikelyAudio(type, url) {
    return type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)(?:[?#]|$)/i.test(url);
  }

  function isImagePreviewUrl(value) {
    const text = String(value || "");
    return /^(data:image\/|blob:)/i.test(text) || isLikelyImage("", text);
  }

  function isVideoPreviewUrl(value) {
    const text = String(value || "");
    return /^data:video\//i.test(text) || isLikelyVideo("", text);
  }

  function isAudioPreviewUrl(value) {
    const text = String(value || "");
    return /^data:audio\//i.test(text) || isLikelyAudio("", text);
  }

  function formatJson(value) {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  }

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    dragState = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragState) return;
    const rect = panel.getBoundingClientRect();
    const nextLeft = Math.min(window.innerWidth - rect.width - 8, Math.max(8, dragState.left + event.clientX - dragState.startX));
    const nextTop = Math.min(window.innerHeight - rect.height - 8, Math.max(8, dragState.top + event.clientY - dragState.startY));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function stopDrag() {
    dragState = null;
  }

  button.addEventListener("click", showPanel);
  panel.querySelector(".dai-tabs").addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", moveDrag);
  window.addEventListener("mouseup", stopDrag);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.style.display === "none") return;
    if (selectedId) {
      selectedId = "";
      render();
      return;
    }
    hidePanel();
  });
  panel.querySelector(".dai-close").addEventListener("click", hidePanel);
  panel.querySelectorAll(".dai-tab").forEach((tab) => tab.addEventListener("click", () => { activeView = tab.dataset.view; selectedId = ""; if (activeView === "network" && activeDetailTab === "headers") activeDetailTab = "preview"; render(); }));
  panel.querySelectorAll("[data-console-filter]").forEach((chip) => chip.addEventListener("click", () => { consoleFilter = chip.dataset.consoleFilter; selectedId = ""; render(); }));
  panel.querySelectorAll("[data-network-filter]").forEach((chip) => chip.addEventListener("click", () => { networkFilter = chip.dataset.networkFilter; selectedId = ""; render(); }));
  panel.querySelector("[data-filter]").addEventListener("input", render);
  panel.querySelector("[data-clear]").addEventListener("click", () => { events.length = 0; selectedId = ""; render(); });
  panel.querySelector("[data-copy]").addEventListener("click", () => {
    const selected = events.find((event) => event.id === selectedId);
    navigator.clipboard?.writeText(JSON.stringify(selected ? [selected] : events, null, 2));
  });
  panel.querySelector(".dai-list").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row || activeView !== "network") return;
    event.preventDefault();
    selectedId = row.dataset.id;
    contextMenuEventId = selectedId;
    const menu = panel.querySelector(".dai-menu");
    menu.style.display = "block";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    render();
  });
  window.addEventListener("click", (event) => {
    if (!panel.querySelector(".dai-menu").contains(event.target)) panel.querySelector(".dai-menu").style.display = "none";
  });
  panel.querySelector("[data-copy-curl]").addEventListener("click", () => copyRequest("curl"));
  panel.querySelector("[data-copy-fetch]").addEventListener("click", () => copyRequest("fetch"));
  panel.querySelector("[data-copy-url]").addEventListener("click", () => copyRequest("url"));
  panel.querySelector("[data-copy-response]").addEventListener("click", () => copyRequest("response"));
  panel.querySelector(".dai-list").addEventListener("click", (event) => {
    const headerSort = event.target.closest("[data-sort]");
    if (headerSort) {
      cycleSort(headerSort.dataset.sort);
      render();
      return;
    }
    const row = event.target.closest("[data-id]");
    if (!row) return;
    selectedId = row.dataset.id;
    render();
  });
  panel.querySelector(".dai-detail").addEventListener("click", (event) => {
    const close = event.target.closest("[data-close-detail]");
    if (close) {
      selectedId = "";
      render();
      return;
    }
    const copy = event.target.closest("[data-copy-block]");
    if (copy) {
      navigator.clipboard?.writeText(decodeURIComponent(copy.dataset.copyBlock || ""));
      copy.textContent = "Copied";
      window.setTimeout(() => {
        copy.textContent = "Copy";
      }, 900);
      return;
    }
    const line = event.target.closest("[data-json-line]");
    const toggle = event.target.closest("[data-json-toggle]") || line;
    if (toggle) {
      const targetId = toggle.dataset.jsonToggle || toggle.dataset.jsonLine;
      const target = panel.querySelector(`#${targetId}`);
      if (target) {
        const hidden = target.classList.toggle("dai-json-hidden");
        toggle.textContent = hidden ? "▸" : "▾";
      }
      return;
    }
    const tab = event.target.closest("[data-detail-tab]");
    if (!tab) return;
    activeDetailTab = tab.dataset.detailTab;
    render();
  });
  function copyRequest(kind) {
    const event = events.find((item) => item.id === contextMenuEventId || item.id === selectedId);
    if (!event) return;
    const url = String(event.message || "").replace(/^\S+\s+/, "");
    let text = url;
    if (kind === "curl") text = toCurl(event, url);
    if (kind === "fetch") text = toFetch(event, url);
    if (kind === "response") text = event.responseBody || "";
    navigator.clipboard?.writeText(text);
    panel.querySelector(".dai-menu").style.display = "none";
  }

  function toCurl(event, url) {
    const parts = [`curl '${shellEscape(url)}'`];
    const method = event.method || "GET";
    if (method !== "GET") parts.push(`-X ${shellEscape(method)}`);
    Object.entries(event.requestHeaders || {}).forEach(([key, value]) => parts.push(`-H '${shellEscape(`${key}: ${value}`)}'`));
    if (event.requestBody) parts.push(`--data-raw '${shellEscape(event.requestBody)}'`);
    return parts.join(" \\\n  ");
  }

  function toFetch(event, url) {
    const init = { method: event.method || "GET" };
    if (event.requestHeaders && Object.keys(event.requestHeaders).length) init.headers = event.requestHeaders;
    if (event.requestBody) init.body = event.requestBody;
    return `fetch(${JSON.stringify(url)}, ${JSON.stringify(init, null, 2)});`;
  }

  function shellEscape(value) {
    return String(value).replace(/'/g, `'\\''`);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "DOM_AI_MONITOR_BRIDGE" || data.type !== "event") return;
    events.unshift(data.event);
    if (events.length > 400) events.length = 400;
    render();
  });

  root.append(button);
  document.documentElement.append(root, panel);
  injectBridge();
})();
