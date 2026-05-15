import type { AnnotationDraft } from "../shared/types";

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

export function createAnnotationDraft(element: Element, pin?: AnnotationDraft["pin"]): AnnotationDraft {
  const rect = element.getBoundingClientRect();
  const htmlElement = element as HTMLElement;

  return {
    url: location.href,
    title: document.title,
    selector: getCssSelector(element),
    xpath: getXPath(element),
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
  if (element.id && isUniqueSelector(`#${cssEscape(element.id)}`)) {
    return `#${cssEscape(element.id)}`;
  }

  for (const selector of getStableSelectorCandidates(element)) {
    if (isUniqueSelector(selector)) return selector;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
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
    if (isUniqueSelector(candidate)) {
      return candidate;
    }

    current = parent;
  }

  return parts.length ? `body > ${parts.join(" > ")}` : "body";
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

function getStableSelectorCandidates(element: Element): string[] {
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

function isUniqueSelector(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
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
