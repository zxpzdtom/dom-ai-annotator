import type { AnnotationDraft, PageContext } from "../shared/types";

const STYLE_PROPS = [
  "display",
  "position",
  "boxSizing",
  "width",
  "height",
  "margin",
  "padding",
  "font",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "zIndex",
  "alignItems",
  "justifyContent",
  "gap",
  "flexDirection",
  "gridTemplateColumns"
];

const STABLE_SELECTOR_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "data-test-id",
  "aria-label",
  "name",
  "placeholder",
  "title",
  "alt"
];

const SHADOW_SELECTOR_SEPARATOR = " >>> ";

export function createAnnotationDraft(element: Element, pin?: AnnotationDraft["pin"], context?: PageContext): AnnotationDraft {
  const rect = element.getBoundingClientRect();
  const htmlElement = element as HTMLElement;

  return {
    url: context?.url || location.href,
    title: context?.title || document.title,
    selector: getCssSelector(element),
    xpath: getXPath(element),
    context,
    element: {
      tag: element.tagName.toLowerCase(),
      id: htmlElement.id || undefined,
      className: typeof htmlElement.className === "string" ? htmlElement.className : undefined,
      text: normalizeText(htmlElement.innerText || htmlElement.textContent || ""),
      role: htmlElement.getAttribute("role") || undefined,
      ariaLabel: htmlElement.getAttribute("aria-label") || undefined
    },
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    pin,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent
    },
    computedStyles: getComputedStyleSnapshot(element)
  };
}

export function getCssSelector(element: Element): string {
  if (!(element instanceof Element)) return "";

  const root = element.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof Element) {
    const hostSelector = getCssSelector(root.host);
    const innerSelector = getCssSelectorWithinRoot(element, root);
    return `${hostSelector}${SHADOW_SELECTOR_SEPARATOR}${innerSelector}`;
  }

  return getCssSelectorWithinRoot(element, document);
}

export function querySelectorDeep(selector: string, root: ParentNode = document): Element | null {
  const segments = selector.split(SHADOW_SELECTOR_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return null;

  let currentRoot: ParentNode | ShadowRoot = root;
  let currentElement: Element | null = null;

  for (const [index, segment] of segments.entries()) {
    try {
      currentElement = currentRoot.querySelector(segment);
    } catch {
      return null;
    }

    if (!currentElement) return null;
    if (index === segments.length - 1) return currentElement;
    if (!currentElement.shadowRoot) return null;
    currentRoot = currentElement.shadowRoot;
  }

  return currentElement;
}

function getCssSelectorWithinRoot(element: Element, root: ParentNode): string {
  if (element.id && isUniqueSelector(`#${cssEscape(element.id)}`, root)) {
    return `#${cssEscape(element.id)}`;
  }

  for (const selector of getStableSelectorCandidates(element, root)) {
    if (isUniqueSelector(selector, root)) return selector;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  const stopElement = root instanceof Document ? root.body : null;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== stopElement) {
    let selector = getElementSelectorSegment(current);
    const currentElement = current as HTMLElement;

    if (currentElement.id) {
      selector += `#${cssEscape(currentElement.id)}`;
      parts.unshift(selector);
      break;
    }

    const parent: Element | null = current.parentElement;
    if (parent) {
      const currentNodeName = current.nodeName;
      const siblings = Array.from(parent.children).filter((child: Element) => child.nodeName === currentNodeName);
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    parts.unshift(selector);
    const candidate = parts.join(" > ");
    if (isUniqueSelector(candidate, root)) {
      return candidate;
    }

    current = parent;
  }

  if (!parts.length) return root instanceof Document ? "body" : getElementSelectorSegment(element);
  return root instanceof Document ? `body > ${parts.join(" > ")}` : parts.join(" > ");
}

function getElementSelectorSegment(element: Element): string {
  const tag = element.nodeName.toLowerCase();
  const stableAttributeSelector = getStableAttributeSelector(element);
  if (stableAttributeSelector) return `${tag}${stableAttributeSelector}`;

  const currentElement = element as HTMLElement;
  const classes = Array.from(currentElement.classList)
    .filter((className) => !className.startsWith("dom-ai-") && !looksGeneratedClassName(className))
    .slice(0, 3);

  return classes.length ? `${tag}.${classes.map(cssEscape).join(".")}` : tag;
}

function getStableSelectorCandidates(element: Element, root: ParentNode): string[] {
  const tag = element.nodeName.toLowerCase();
  const candidates: string[] = [];

  const stableAttributeSelector = getStableAttributeSelector(element);
  if (stableAttributeSelector) {
    candidates.push(stableAttributeSelector, `${tag}${stableAttributeSelector}`);
  }

  const role = cleanAttributeValue(element.getAttribute("role"));
  if (role) {
    candidates.push(`[role="${cssStringEscape(role)}"]`, `${tag}[role="${cssStringEscape(role)}"]`);
  }

  return candidates;
}

function getStableAttributeSelector(element: Element): string {
  for (const attr of STABLE_SELECTOR_ATTRIBUTES) {
    const value = cleanAttributeValue(element.getAttribute(attr));
    if (value) return `[${attr}="${cssStringEscape(value)}"]`;
  }
  return "";
}

function getXPath(element: Element): string {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof Element) {
    return `${getXPath(root.host)}/shadow-root/${getXPathWithinRoot(element)}`;
  }

  return getXPathWithinRoot(element);
}

function getXPathWithinRoot(element: Element): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.nodeName === current.nodeName) index += 1;
      sibling = sibling.previousElementSibling;
    }

    segments.unshift(`${current.nodeName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return `/${segments.join("/")}`;
}

function getComputedStyleSnapshot(element: Element): Record<string, string> {
  const styles = window.getComputedStyle(element);
  return Object.fromEntries(STYLE_PROPS.map((prop) => [prop, styles.getPropertyValue(toKebab(prop)) || styles.getPropertyValue(prop)]));
}

function isUniqueSelector(selector: string, root: ParentNode = document): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function normalizeText(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function cssStringEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
}

function cleanAttributeValue(value: string | null): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized && normalized.length <= 120 ? normalized : "";
}

function looksGeneratedClassName(className: string): boolean {
  return (
    className.length > 32 ||
    /(^|[-_])[a-f0-9]{6,}($|[-_])/i.test(className) ||
    /^[a-z]+-[a-z0-9_-]*__[a-z0-9_-]+$/i.test(className)
  );
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
