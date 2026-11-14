"use client";

import { useId } from "react";
import { BRAND_OUTLINE, BRAND_VIEW_BOX } from "@/lib/brand";

// Center lines reveal the exact silhouette, preserving the supplied logo's tapered strokes.
const drawingStrokes = [
  {
    phase: "stem",
    d: "M717 1005 C811 1007 865 952 864 866 L864 710 C861 640 893 577 960 521",
  },
  { phase: "stem", d: "M903 498 H717 C752 502 773 529 773 572 L773 765" },
  {
    phase: "leaves",
    d: "M717 1005 C767 1004 773 970 773 930 L773 877 C774 814 728 755 665 733",
  },
  {
    phase: "leaves",
    d: "M773 765 C724 696 656 669 590 670 C588 735 631 786 690 800",
  },
  {
    phase: "leaves",
    d: "M773 849 C804 748 887 691 967 711 C1016 713 1052 741 1062 782 C1002 820 964 764 917 749",
  },
  {
    phase: "leaves",
    d: "M903 709 C946 642 1004 647 1036 665 C1081 686 1111 696 1143 685 C1127 737 1090 760 1032 735",
  },
  {
    phase: "petals",
    d: "M958 518 C899 466 883 385 914 318 C955 223 1026 266 1040 314 C1068 395 1010 497 958 518",
  },
  {
    phase: "petals",
    d: "M1045 335 C1115 295 1185 304 1170 383 C1155 460 1070 528 963 522",
  },
  {
    phase: "petals",
    d: "M1151 442 C1203 453 1220 481 1218 511 C1219 555 1171 585 1110 581 C1052 584 998 554 962 524",
  },
  {
    phase: "finish",
    d: "M958 518 C953 455 982 398 1011 362 M959 519 C1012 462 1067 440 1114 439",
  },
  {
    phase: "finish",
    d: "M819 1112 C832 1011 911 909 1046 915 C1027 974 979 1020 910 1020",
  },
];

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      viewBox={BRAND_VIEW_BOX}
      width="32"
      height="43"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <path d={BRAND_OUTLINE} />
    </svg>
  );
}

export function AnimatedBrandMark() {
  const maskId = `brand-draw-${useId().replaceAll(":", "")}`;
  return (
    <svg
      className="brand-mark brand-mark-drawing"
      viewBox={BRAND_VIEW_BOX}
      width="84"
      height="112"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="670"
          height="890"
          style={{ maskType: "luminance" }}
        >
          <g
            transform="translate(-570 -245)"
            fill="none"
            stroke="white"
            strokeWidth="45"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="brand-draw-mask"
          >
            {drawingStrokes.map(({ phase, d }, index) => (
              <path
                key={index}
                d={d}
                pathLength="1"
                className={`brand-draw-stroke brand-draw-${phase}`}
              />
            ))}
          </g>
        </mask>
      </defs>
      <path d={BRAND_OUTLINE} fill="currentColor" opacity="0.08" />
      <path d={BRAND_OUTLINE} fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
