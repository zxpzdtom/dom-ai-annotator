import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Wraps specified entry bundles in an IIFE to avoid top-level variable collisions
 * when multiple MAIN-world content scripts run in the same global scope.
 */
function wrapIIFE(entryNames: string[]): Plugin {
  return {
    name: "wrap-iife",
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        if (!entryNames.some((name) => fileName === `${name}.js`)) continue;
        chunk.code = `(function(){${chunk.code}})();\n`;
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), wrapIIFE(["monitorBridge", "agentBridge", "agentBridgeHost"])],
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        devtools: "src/devtools/index.html",
        devtoolsPanel: "src/devtools-panel/index.html",
        sidepanel: "src/sidepanel/index.html",
        content: "src/content/main.tsx",
        jsonViewerVendor: "src/content/jsonViewerVendor.ts",
        monitorBridge: "src/content/monitorBridge.ts",
        agentBridge: "src/content/agentBridge.ts",
        agentBridgeHost: "src/content/agentBridgeHost.ts",
        background: "src/background.ts"
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
