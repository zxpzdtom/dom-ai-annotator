import React, { useCallback, useMemo, useState } from "react";

interface JsonTreeProps {
  data: unknown;
  defaultExpandDepth?: number;
}

export function JsonTree({ data, defaultExpandDepth = 1 }: JsonTreeProps) {
  const [expandAll, setExpandAll] = useState<boolean | null>(null);

  return (
    <div className="font-mono text-[12px] leading-5">
      <div className="mb-2 flex gap-2">
        <button
          className="rounded bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600 hover:bg-ink-200"
          onClick={() => setExpandAll(true)}
        >
          Expand All
        </button>
        <button
          className="rounded bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600 hover:bg-ink-200"
          onClick={() => setExpandAll(false)}
        >
          Collapse All
        </button>
      </div>
      <JsonNode name={null} value={data} depth={0} defaultExpandDepth={defaultExpandDepth} expandAll={expandAll} />
    </div>
  );
}

interface JsonNodeProps {
  name: string | null;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
  expandAll: boolean | null;
}

function JsonNode({ name, value, depth, defaultExpandDepth, expandAll }: JsonNodeProps) {
  const isExpandable = value !== null && typeof value === "object";
  const [manualExpanded, setManualExpanded] = useState<boolean | undefined>(undefined);

  const isExpanded = useMemo(() => {
    if (expandAll !== null) return expandAll;
    if (manualExpanded !== undefined) return manualExpanded;
    return depth < defaultExpandDepth;
  }, [expandAll, manualExpanded, depth, defaultExpandDepth]);

  const toggle = useCallback(() => {
    setManualExpanded((prev) => {
      if (expandAll !== null) return !expandAll;
      if (prev !== undefined) return !prev;
      return !(depth < defaultExpandDepth);
    });
  }, [expandAll, depth, defaultExpandDepth]);

  // Reset manual state when expandAll changes
  React.useEffect(() => {
    if (expandAll !== null) setManualExpanded(undefined);
  }, [expandAll]);

  if (!isExpandable) {
    return (
      <div className="flex" style={{ paddingLeft: depth * 16 }}>
        {name !== null ? <span className="mr-1 text-[#881391]">{name}:</span> : null}
        <ValueDisplay value={value} />
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const isArray = Array.isArray(value);
  const bracket = isArray ? ["[", "]"] : ["{", "}"];
  const count = entries.length;

  return (
    <div>
      <div
        className="flex cursor-pointer items-center hover:bg-ink-50"
        style={{ paddingLeft: depth * 16 }}
        onClick={toggle}
      >
        <span className="mr-1 inline-block w-3 text-center text-[10px] text-ink-400">
          {isExpanded ? "▼" : "▶"}
        </span>
        {name !== null ? <span className="mr-1 text-[#881391]">{name}:</span> : null}
        {!isExpanded ? (
          <span className="text-ink-500">
            {bracket[0]}{" "}
            <span className="text-[11px] text-ink-400">{count} {isArray ? (count === 1 ? "item" : "items") : (count === 1 ? "key" : "keys")}</span>
            {" "}{bracket[1]}
          </span>
        ) : (
          <span className="text-ink-500">{bracket[0]}</span>
        )}
      </div>
      {isExpanded ? (
        <>
          {entries.map(([key, val]) => (
            <JsonNode
              key={key}
              name={isArray ? key : key}
              value={val}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              expandAll={expandAll}
            />
          ))}
          <div style={{ paddingLeft: depth * 16 }}>
            <span className="ml-4 text-ink-500">{bracket[1]}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null) return <span className="text-[#808080]">null</span>;
  if (value === undefined) return <span className="text-[#808080]">undefined</span>;
  if (typeof value === "string") return <span className="text-[#0b7611]">"{value.length > 300 ? value.slice(0, 300) + "..." : value}"</span>;
  if (typeof value === "number") return <span className="text-[#1a5fb4]">{value}</span>;
  if (typeof value === "boolean") return <span className="text-[#8b008b]">{String(value)}</span>;
  return <span className="text-ink-600">{String(value)}</span>;
}
