import React, { useEffect, useRef } from "react";

type Props = {
  /** Parent must be position: relative; */
  containerRef: React.RefObject<HTMLElement>;
};

/**
 * Lightweight overlay that manipulates the DOM directly for 60fps hover feedback
 * without forcing a React re-render of the heavy timeline.
 */
export function TimelineHoverOverlay({ containerRef }: Props) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Prepare overlay layer
    const layer = document.createElement("div");
    layer.style.position = "absolute";
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.right = "0";
    layer.style.bottom = "0";
    layer.style.pointerEvents = "none";
    el.appendChild(layer);

    const line = document.createElement("div");
    line.style.position = "absolute";
    line.style.top = "0";
    line.style.bottom = "0";
    line.style.width = "1px";
    line.style.background = "rgba(255,255,255,0.6)";
    line.style.transform = "translateX(0px)";
    line.style.willChange = "transform";
    layer.appendChild(line);
    lineRef.current = line;

    const dot = document.createElement("div");
    dot.style.position = "absolute";
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.borderRadius = "9999px";
    dot.style.background = "white";
    dot.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.3)";
    dot.style.transform = "translate(-4px, -4px)";
    dot.style.willChange = "transform,left,top";
    dot.style.top = "50%"; // you can update Y externally if needed
    layer.appendChild(dot);
    dotRef.current = dot;

    const tip = document.createElement("div");
    tip.style.position = "absolute";
    tip.style.padding = "4px 8px";
    tip.style.borderRadius = "6px";
    tip.style.background = "rgba(16,24,40,0.9)";
    tip.style.color = "white";
    tip.style.fontSize = "12px";
    tip.style.transform = "translate(8px, 8px)";
    tip.style.whiteSpace = "nowrap";
    tip.style.pointerEvents = "none";
    tip.style.willChange = "transform,left";
    layer.appendChild(tip);
    tipRef.current = tip;

    return () => {
      el.removeChild(layer);
    };
  }, [containerRef]);

  // Provide an imperative API via DOM CustomEvent for updates
  useEffect(() => {
    function onUpdate(e: any) {
      const { x, label } = e.detail || {};
      if (lineRef.current) lineRef.current.style.transform = `translateX(${x}px)`;
      if (dotRef.current) {
        dotRef.current.style.left = `${x}px`;
      }
      if (tipRef.current) {
        tipRef.current.style.left = `${x}px`;
        tipRef.current.textContent = label ?? "";
      }
    }
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("timeline-hover-update", onUpdate as any);
    return () => el.removeEventListener("timeline-hover-update", onUpdate as any);
  }, [containerRef]);

  return null;
}