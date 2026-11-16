"use client";
import { Children, useLayoutEffect, useRef, type ReactNode } from "react";
import { masonryPositions } from "@/lib/masonry";

/** Flat DOM order keeps sorting and keyboard navigation in product order. */
export function MasonryGrid({
  children,
  enabled = true,
  previewRows,
}: {
  children: ReactNode;
  enabled?: boolean;
  previewRows?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const items = Array.from(grid.children) as HTMLElement[];
    const reset = () => {
      delete grid.dataset.masonryReady;
      grid.style.height = "";
      for (const item of items) {
        item.style.width = "";
        item.style.left = "";
        item.style.top = "";
      }
    };
    if (!enabled) {
      reset();
      return;
    }
    let frame = 0;
    let disposed = false;
    const layout = () => {
      const width = grid.getBoundingClientRect().width;
      if (width <= 0) return;
      const css = getComputedStyle(grid);
      const columns = Math.max(
        1,
        parseInt(css.getPropertyValue("--product-columns"), 10) || 1,
      );
      const columnGap = parseFloat(css.columnGap) || 0;
      const rowGap = parseFloat(css.rowGap) || 0;
      const columnWidth = (width - (columns - 1) * columnGap) / columns;
      // Set all widths before measuring text/image height at the new breakpoint.
      for (const item of items) item.style.width = `${columnWidth}px`;
      const visibleItems = items.filter(
        (item) => getComputedStyle(item).display !== "none",
      );
      const { positions, height } = masonryPositions(
        visibleItems.map((item) => item.getBoundingClientRect().height),
        columns,
        columnWidth,
        columnGap,
        rowGap,
        previewRows,
      );
      visibleItems.forEach((item, index) => {
        item.style.left = `${positions[index].left}px`;
        item.style.top = `${positions[index].top}px`;
      });
      grid.style.height = `${height}px`;
      grid.dataset.masonryReady = "true";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!disposed) layout();
      });
    };
    // CSS Grid remains the readable SSR/no-JS fallback until measured.
    layout();
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    items.forEach((item) => observer.observe(item));
    void document.fonts.ready.then(() => {
      if (!disposed) schedule();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [children, enabled, previewRows]);
  return (
    <div
      ref={ref}
      data-preview-rows={previewRows}
      className={`product-grid ${enabled ? "product-masonry" : "uniform"}`}
    >
      {Children.toArray(children).map((child, index) => (
        <div
          className="product-grid-item"
          key={
            typeof child === "object" && child !== null && "key" in child
              ? child.key
              : index
          }
        >
          {child}
        </div>
      ))}
    </div>
  );
}
