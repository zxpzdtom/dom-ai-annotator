import { useCallback, useEffect, useRef, useState } from "react";

const MIN_COL_WIDTH = 50;

export function useColumnResize(initialWidths: number[]) {
  const [widths, setWidths] = useState(initialWidths);
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  const onResizeStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { index, startX: e.clientX, startWidth: widths[index] };
  }, [widths]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const ctx = resizingRef.current;
      if (!ctx) return;
      const delta = e.clientX - ctx.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, ctx.startWidth + delta);
      setWidths((prev) => {
        const next = [...prev];
        next[ctx.index] = newWidth;
        return next;
      });
    }

    function onMouseUp() {
      resizingRef.current = null;
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const isResizing = useCallback(() => resizingRef.current !== null, []);

  return { widths, onResizeStart, isResizing };
}
