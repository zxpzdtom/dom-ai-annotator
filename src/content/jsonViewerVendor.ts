import JSONEditor from "jsoneditor";
import jsonEditorCss from "jsoneditor/dist/jsoneditor.min.css?inline";

type ViewerOptions = {
  container: HTMLElement;
  data: string;
  theme?: "light" | "dark";
  expand?: boolean;
};

class DomAiJsonViewer {
  private editor: JSONEditor;

  constructor(options: ViewerOptions) {
    ensureJsonEditorStyles();
    this.editor = new JSONEditor(options.container, {
      mode: "view",
      mainMenuBar: false,
      navigationBar: false,
      statusBar: false,
      search: false,
      onEditable: () => false
    });
    this.editor.set(JSON.parse(options.data));
    if (options.expand) {
      this.editor.expandAll();
    }
  }

  destroy() {
    this.editor.destroy();
  }
}

function ensureJsonEditorStyles() {
  if (document.getElementById("dom-ai-jsoneditor-style")) return;
  const style = document.createElement("style");
  style.id = "dom-ai-jsoneditor-style";
  style.textContent = jsonEditorCss;
  document.head.append(style);
}

declare global {
  interface Window {
    DOM_AI_JsonViewer?: typeof DomAiJsonViewer;
  }
}

window.DOM_AI_JsonViewer = DomAiJsonViewer;
