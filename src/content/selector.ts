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

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let selector = current.nodeName.toLowerCase();
    const currentElement = current as HTMLElement;

    if (currentElement.id) {
      selector += `#${cssEscape(currentElement.id)}`;
      parts.unshift(selector);
      break;
    }

    const classes = Array.from(currentElement.classList)
      .filter((className) => !className.startsWith("dom-ai-"))
      .slice(0, 3);

    if (classes.length) {
      selector += `.${classes.map(cssEscape).join(".")}`;
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

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
