"use client";
import type { CardWritingMode } from "@/lib/card-design";

export function CardWritingChoice({
  value,
  onChange,
}: {
  value: CardWritingMode;
  onChange: (value: CardWritingMode) => void;
}) {
  return (
    <fieldset className="card-writing-choice">
      <legend>Cách viết thiệp</legend>
      <div>
        <label className={value === "AUTO" ? "selected" : ""}>
          <input
            type="radio"
            name="cardWritingMode"
            value="AUTO"
            checked={value === "AUTO"}
            onChange={() => onChange("AUTO")}
          />
          <span>
            <strong>Thiệp tự động</strong>
            <small>In sẵn lời nhắn trên thiệp.</small>
          </span>
        </label>
        <label className={value === "HANDWRITTEN" ? "selected" : ""}>
          <input
            type="radio"
            name="cardWritingMode"
            value="HANDWRITTEN"
            checked={value === "HANDWRITTEN"}
            onChange={() => onChange("HANDWRITTEN")}
          />
          <span>
            <strong>Thiệp viết tay</strong>
            <small>Để trống lời nhắn trên thiệp để viết tay.</small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
