export const CARD_DPI = 600;
export const CARD_SIZES = {
  front: { width: 74, height: 105 },
  back: { width: 90, height: 50 },
  blank: { width: 74, height: 105 },
  brand: { width: 60, height: 60 },
} as const;
export type CardWritingMode = "AUTO" | "HANDWRITTEN";
export const cardWritingLabels = {
  AUTO: "Thiệp tự động",
  HANDWRITTEN: "Thiệp viết tay",
} as const;
