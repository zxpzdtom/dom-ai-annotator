# DOM AI Annotator — MCP Integration

This project uses the DOM AI Annotator Chrome extension with the Chrome DevTools MCP server (`chrome-devtools`). AI agents can read UI annotations, console errors, and network issues directly from the browser.

## MCP Setup

Add to your IDE's MCP configuration:

**Claude Code** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@anthropic-ai/chrome-devtools-mcp@latest"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@anthropic-ai/chrome-devtools-mcp@latest"]
    }
  }
}
```

## Reading Data

Use `mcp__chrome-devtools__evaluate_script` to call `window.__domAiAPI` methods. All methods are synchronous and return `{ success: true, data? }` or `{ success: false, error }`.

### Quick Start

```javascript
// Get a full page overview (start here)
() => window.__domAiAPI.getSummary()

// Get all pending annotations for this page
() => window.__domAiAPI.getAnnotations()

// Get console errors
() => window.__domAiAPI.getConsoleErrors()

// Get failed network requests
() => window.__domAiAPI.getNetworkIssues()

// Get all suspicious events (errors + failed requests combined)
() => window.__domAiAPI.getSuspicious()

// Show available methods
() => window.__domAiAPI.help()
```

### Filtering

```javascript
// Only pending annotations
() => window.__domAiAPI.getAnnotations({ status: "pending" })

// Only blocking severity
() => window.__domAiAPI.getAnnotations({ severity: "blocking" })

// Console warnings (not just errors)
() => window.__domAiAPI.getConsoleErrors({ severity: "warn", limit: 10 })

// Only 5xx server errors
() => window.__domAiAPI.getNetworkIssues({ statusFilter: "5xx" })

// Slow requests (>3s)
() => window.__domAiAPI.getNetworkIssues({ statusFilter: "slow" })
```

### Writing (After Fixing)

```javascript
// Mark an annotation as resolved
() => window.__domAiAPI.resolveAnnotation("annotation-id-here")

// Update status to any value
() => window.__domAiAPI.updateAnnotationStatus("id", "passed")
```

## Workflow

When asked to check reviews, fix issues, or work with DOM AI Annotator:

1. **Read overview** — call `getSummary()` to understand what's on the page
2. **Get details** — call `getAnnotations()` for UI feedback, `getConsoleErrors()` for runtime errors, `getNetworkIssues()` for API problems
3. **Fix issues** — use `selector` and element context from annotations to find the right source files
4. **Resolve** — call `resolveAnnotation(id)` to mark fixed items as done

## Data Format

Each annotation contains:

- `id` — unique identifier
- `url` — page URL this annotation belongs to
- `selector` — CSS selector pointing to the reviewed element
- `xpath` — XPath fallback
- `element` — tag, id, className, text, role, ariaLabel
- `rect` — bounding box position
- `viewport` — viewport size and device pixel ratio
- `computedStyles` — key CSS properties (display, position, fontSize, color, etc.)
- `feedback.comment` — the review comment describing what needs to change
- `feedback.severity` — `blocking` | `important` | `suggestion`
- `feedback.type` — `bug` | `style` | `copy` | `layout` | `interaction` | `question`
- `status` — `pending` | `sent` | `changed` | `needs_work` | `passed` | `skipped`

## Build

```bash
npm install
npm run build
```

Load `dist/` folder as unpacked extension in `chrome://extensions` (developer mode).
