"use client";

import { Heart, Leaf, Truck } from "lucide-react";
import { FlowerIcon } from "./flower-icon";

const promises = [
  { Icon: FlowerIcon, text: "Hoa tươi chọn mỗi ngày" },
  { Icon: Truck, text: "Giao tận tay tại Hà Nội" },
  { Icon: Heart, text: "Thiệp viết tay, gửi lời thương" },
  { Icon: Leaf, text: "Nâng niu từng chi tiết" },
];

export function PromiseStrip() {
  return (
    <div className="promise-strip">
      <div className="promise-strip-window">
        <div className="promise-strip-track">
          {[false, true].map((duplicate) => (
            <div
              className="promise-strip-group"
              key={String(duplicate)}
              aria-hidden={duplicate ? true : undefined}
            >
              {promises.map(({ Icon, text }) => (
                <span key={text}>
                  <Icon aria-hidden="true" /> {text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
