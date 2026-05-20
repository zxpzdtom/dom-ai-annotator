/// <reference types="vite/client" />

declare module "jsoneditor" {
  export default class JSONEditor {
    constructor(container: HTMLElement, options?: Record<string, unknown>);
    set(json: unknown): void;
    expandAll(): void;
    destroy(): void;
  }
}

declare module "*.css?inline" {
  const content: string;
  export default content;
}
