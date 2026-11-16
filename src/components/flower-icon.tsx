"use client";

import { useId } from "react";
import type { LucideProps } from "lucide-react";

/** Keep the supplied flower silhouette exact and inherit each UI surface's color. */
export function FlowerIcon({
  size = 24,
  color = "currentColor",
  className = "",
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...props
}: LucideProps) {
  const maskId = `flower-${useId().replaceAll(":", "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="112 52 288 408"
      fill="none"
      stroke="none"
      className={`flower-icon ${className}`}
      aria-hidden={
        props["aria-label"] || props["aria-labelledby"] ? undefined : true
      }
      focusable="false"
      {...props}
    >
      <defs>
        <mask
          id={maskId}
          x="0"
          y="0"
          width="512"
          height="512"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "alpha" }}
        >
          <image href="/icons/flower-symbol-v1.png" width="512" height="512" />
        </mask>
      </defs>
      <rect width="512" height="512" fill={color} mask={`url(#${maskId})`} />
    </svg>
  );
}
