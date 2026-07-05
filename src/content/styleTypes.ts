import type React from "react";
import type { AnnotationDraft, AnnotationScreenshot, AnnotationStyleChange, PageContext } from "../shared/types";

export type StyleEditorHandle = {
  revertStyles: () => void;
};

export type RectSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HoverInspection = {
  key: string;
  label: string;
  element?: Element;
  textContent: string;
  viewportRect: RectSnapshot;
  documentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  display: string;
  position: string;
  opacity: string;
  textAlign: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  gridAutoFlow: string;
  zIndex: string;
  gap: string;
  rowGap: string;
  columnGap: string;
  margin: string;
  padding: string;
  borderRadius: string;
  borderColor: string;
  borderWidth: string;
  width: string;
  height: string;
};

export type EditableStyleValues = {
  textContent: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  opacity: string;
  textAlign: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  gridAutoFlow: string;
  gap: string;
  rowGap: string;
  columnGap: string;
  borderRadius: string;
  borderColor: string;
  borderWidth: string;
  width: string;
  height: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
};

export type EditableStyleField = {
  property: keyof EditableStyleValues;
  cssProperty?: string;
  label: string;
};

export type InlineStyleSnapshot = Record<string, { value: string; priority: string } | null>;

export type NumericAdjusterConfig = {
  property: keyof EditableStyleValues;
  cssProperty: string;
  label: string;
  min: number;
  max: number;
  fallback: number;
  dragScale: number;
  unit: string;
  cssUnit: string;
  precision: number;
  step: number;
};

export type NumericAdjusterConfigs = {
  fontSize: NumericAdjusterConfig;
  lineHeight: NumericAdjusterConfig;
  opacity: NumericAdjusterConfig;
  gap: NumericAdjusterConfig;
  rowGap: NumericAdjusterConfig;
  columnGap: NumericAdjusterConfig;
  borderRadius: NumericAdjusterConfig;
  borderWidth: NumericAdjusterConfig;
  width: NumericAdjusterConfig;
  height: NumericAdjusterConfig;
  marginTop: NumericAdjusterConfig;
  marginRight: NumericAdjusterConfig;
  marginBottom: NumericAdjusterConfig;
  marginLeft: NumericAdjusterConfig;
  paddingTop: NumericAdjusterConfig;
  paddingRight: NumericAdjusterConfig;
  paddingBottom: NumericAdjusterConfig;
  paddingLeft: NumericAdjusterConfig;
};

export type NumericChangeHandler = (
  config: NumericAdjusterConfig,
  value: string | number,
  linkedConfigs?: NumericAdjusterConfig[]
) => void;

export type NumericDragHandler = (
  config: NumericAdjusterConfig,
  event: React.PointerEvent<HTMLInputElement>,
  linkedConfigs?: NumericAdjusterConfig[]
) => void;

export type ActiveNumericScrub = {
  property: keyof EditableStyleValues;
  peerProperties: Array<keyof EditableStyleValues>;
} | null;

export type BoxSpacingProperty =
  | "marginTop"
  | "marginRight"
  | "marginBottom"
  | "marginLeft"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft";

export type ColorMode = "rgb" | "hex" | "hsl";

export type IframeSelectionPayload = {
  draft: AnnotationDraft;
  inspection: SerializableHoverInspection;
  inlineStyleSnapshot?: InlineStyleSnapshot;
  fontFamilies?: string[];
  pointerViewport?: RectSnapshot;
  initialScreenshot?: AnnotationScreenshot;
  context: PageContext;
};

export type SerializableHoverInspection = Omit<HoverInspection, "element">;

export type StyleEditorProps = {
  inspection: HoverInspection;
  resetKey: string;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onStyleChangesChange: (changes: AnnotationStyleChange[]) => void;
  onScrubActiveChange: (active: boolean) => void;
};
