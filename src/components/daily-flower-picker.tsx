"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Flower2, Shuffle } from "lucide-react";
import { DailyCalendar } from "./daily-calendar";
import { request } from "./shop-provider";
import { money } from "@/lib/time";
import type { DailyOfferingView } from "@/lib/daily-types";

type Day = {
  day: string;
  slotId: string;
  offeringId?: string;
  autoSelected?: boolean;
};
export function DailyFlowerPicker({
  days,
  offerings,
  mode,
  preferences,
  children,
  onMode,
  onPick,
  onClear,
  onAssignments,
}: {
  days: readonly Day[];
  offerings: DailyOfferingView[];
  mode: "AUTO" | "SELF";
  preferences: { avoidTags: string[]; style: string };
  children?: ReactNode;
  onMode: (mode: "AUTO" | "SELF") => void;
  onPick: (day: string, offeringId: string) => void;
  onClear: (day: string) => void;
  onAssignments: (
    days: { day: string; offeringId: string }[],
    allowedIds: string[],
  ) => void;
}) {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const [selectedDay, setSelectedDay] = useState(sorted[0]?.day ?? ""),
    [month, setMonth] = useState(sorted[0]?.day.slice(0, 7) ?? ""),
    [generation, setGeneration] = useState({
      seed: "",
      revision: 0,
      replaceAuto: false,
    }),
    [checking, setChecking] = useState(false),
    [error, setError] = useState("");
  const completed = useRef(0),
    attempted = useRef("");
  const eligible = offerings.filter(
    (o) =>
      o.active &&
      !preferences.avoidTags.some((t) =>
        o.tags.some((tag) => tag.toLocaleLowerCase() === t.toLocaleLowerCase()),
      ),
  );
  const allowedIds = eligible.map((o) => o.id),
    valid = new Set(allowedIds);
  const invalidKey = JSON.stringify(
    days
      .filter((d) => d.offeringId && !valid.has(d.offeringId))
      .map((d) => d.day),
  );
  useEffect(() => {
    for (const day of JSON.parse(invalidKey) as string[]) onClear(day);
  }, [invalidKey]);
  const datesKey = sorted.map((d) => d.day).join(",");
  useEffect(() => {
    if (!sorted.some((d) => d.day === selectedDay)) {
      setSelectedDay(sorted[0]?.day ?? "");
      setMonth(sorted[0]?.day.slice(0, 7) ?? "");
    }
  }, [datesKey, selectedDay]);
  const requestKey = JSON.stringify({
    mode,
    dates: sorted.map(({ day, slotId }) => ({ day, slotId })),
    allowedIds,
    preferences,
    generation,
  });
  useEffect(() => {
    if (mode !== "AUTO") {
      attempted.current = "";
      setChecking(false);
      setError("");
      return;
    }
    if (!eligible.length) {
      setChecking(false);
      return;
    }
    const force = generation.revision > completed.current;
    const missing = sorted.some(
      (d) => !d.offeringId || !valid.has(d.offeringId),
    );
    if (!missing && !force) {
      setChecking(false);
      return;
    }
    if (attempted.current === requestKey) return;
    attempted.current = requestKey;
    let alive = true;
    setChecking(true);
    setError("");
    const replaceAuto = force && generation.replaceAuto;
    request<{ day: string; offeringId: string }[]>("daily/suggestions", {
      seed: generation.seed || crypto.randomUUID(),
      offeringIds: allowedIds,
      days: sorted.map((d) => ({
        day: d.day,
        slotId: d.slotId,
        ...(d.offeringId &&
        valid.has(d.offeringId) &&
        (!replaceAuto || !d.autoSelected)
          ? { offeringId: d.offeringId }
          : {}),
      })),
      preferences: { ...preferences, colors: [], surprise: false },
    })
      .then((assignments) => {
        if (alive) {
          completed.current = generation.revision;
          onAssignments(assignments, allowedIds);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
      // An interrupted effect (including Strict Mode's mount check) must be retryable.
      if (attempted.current === requestKey) attempted.current = "";
    };
  }, [requestKey]);
  const current = sorted.find((d) => d.day === selectedDay) ?? sorted[0],
    chosen = current?.offeringId
      ? eligible.find((o) => o.id === current.offeringId)
      : undefined,
    assigned = sorted.filter(
      (d) => d.offeringId && valid.has(d.offeringId),
    ).length;
  const date = (day: string) => day.split("-").reverse().join("/");
  const selectDay = (day: string) => {
    setSelectedDay(day);
    setMonth(day.slice(0, 7));
  };
  const regenerate = (replaceAuto: boolean) =>
    setGeneration((g) => ({
      seed: crypto.randomUUID(),
      revision: g.revision + 1,
      replaceAuto,
    }));
  return (
    <>
      <div className="daily-choice-grid daily-selection-modes">
        {[
          {
            id: "AUTO" as const,
            title: "Fleurious chọn giúp",
            text: "Chia đều các mẫu, bạn vẫn có thể đổi hoa cho từng ngày.",
            Icon: Shuffle,
          },
          {
            id: "SELF" as const,
            title: "Tôi tự chọn",
            text: "Bấm ngày trên lịch rồi chọn bó hoa bạn thích.",
            Icon: Flower2,
          },
        ].map(({ id, title, text, Icon }) => (
          <button
            type="button"
            className={`daily-choice ${mode === id ? "selected" : ""}`}
            key={id}
            aria-pressed={mode === id}
            onClick={() => {
              if (mode !== id) onMode(id);
            }}
          >
            <Icon size={22} />
            <strong>{title}</strong>
            <span>{text}</span>
          </button>
        ))}
      </div>
      {children}
      <div className="daily-flower-toolbar">
        <p>Chọn một ngày trên lịch để xem hoặc đổi bó hoa cho ngày đó.</p>
        {mode === "AUTO" && (
          <button
            type="button"
            className="button secondary"
            disabled={checking || !eligible.length}
            onClick={() => regenerate(true)}
          >
            <Shuffle size={15} />
            Gợi ý lại
          </button>
        )}
      </div>
      <div className="daily-flower-status" role="status" aria-live="polite">
        {checking ? "Đang chia hoa cho các ngày đã chọn…" : error || ""}
      </div>
      {error && mode === "AUTO" && (
        <button
          type="button"
          className="text-link"
          onClick={() => regenerate(true)}
        >
          Thử gợi ý lại
        </button>
      )}
      <div className="daily-flower-workspace">
        <div className="daily-flower-calendar-panel">
          <DailyCalendar
            month={month}
            onMonth={setMonth}
            readOnly
            activeDay={current?.day}
            selected={Object.fromEntries(
              sorted.map((d) => {
                const o = eligible.find((o) => o.id === d.offeringId);
                return [
                  d.day,
                  {
                    image: o?.image,
                    pending: !o,
                    state: o
                      ? `${o.name}, ${d.autoSelected ? "Gợi ý" : "Bạn đã chọn"}`
                      : "Chưa chọn hoa",
                  },
                ];
              }),
            )}
            onDay={selectDay}
          />
          <div className="daily-flower-completion">
            <strong>
              Đã chọn hoa {assigned}/{days.length} ngày
            </strong>
            <span>Ngày có ảnh đã có bó hoa. Viền đậm là ngày đang xem.</span>
          </div>
          {mode === "AUTO" &&
            days.length > new Set(eligible.map((o) => o.productId)).size &&
            eligible.length > 0 && (
              <p className="small muted daily-calendar-note">
                Số ngày nhiều hơn số mẫu: hoa được luân phiên sau mỗi vòng. Các
                ngày bạn tự chỉnh luôn được giữ lại.
              </p>
            )}
        </div>
        <div className="daily-flower-catalog-panel">
          <div className="daily-flower-day-heading">
            <div>
              <span>CHỌN HOA CHO NGÀY</span>
              <h3>{current ? date(current.day) : "Chọn một ngày"}</h3>
              <p>
                {chosen
                  ? `${chosen.name} · ${current?.autoSelected ? "Gợi ý tự động" : "Bạn đã chọn"}`
                  : "Ngày này chưa có bó hoa."}
              </p>
            </div>
            {current && days.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label="Ngày chọn hoa tiếp theo"
                title="Ngày tiếp theo"
                onClick={() =>
                  selectDay(
                    sorted[
                      (sorted.findIndex((d) => d.day === current.day) + 1) %
                        sorted.length
                    ].day,
                  )
                }
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>
          {mode === "AUTO" && current?.offeringId && !current.autoSelected && (
            <button
              type="button"
              className="text-link daily-flower-restore"
              onClick={() => {
                onClear(current.day);
                regenerate(false);
              }}
            >
              Dùng lại gợi ý cho ngày này
            </button>
          )}
          <div
            className="daily-flower-options"
            role="radiogroup"
            aria-label={`Bó hoa ngày ${current ? date(current.day) : "đã chọn"}`}
          >
            {eligible.map((o) => (
              <label
                className={`daily-flower-option ${chosen?.id === o.id ? "selected" : ""}`}
                key={o.id}
              >
                <input
                  type="radio"
                  name={`daily-flower-${current?.day}`}
                  value={o.id}
                  checked={chosen?.id === o.id}
                  disabled={!current}
                  aria-label={`Chọn ${o.name}, size ${o.variantName} cho ngày ${current ? date(current.day) : "đã chọn"}`}
                  onClick={() => {
                    if (current && chosen?.id === o.id && current.autoSelected)
                      onPick(current.day, o.id);
                  }}
                  onChange={() => {
                    if (current) onPick(current.day, o.id);
                  }}
                />
                <img
                  src={o.image}
                  alt=""
                  width="240"
                  height="180"
                  loading="lazy"
                />
                <span className="daily-flower-option-check" aria-hidden="true">
                  {chosen?.id === o.id && <Check size={14} />}
                </span>
                <span className="daily-flower-option-info">
                  <strong>{o.name}</strong>
                  <span>Size {o.variantName}</span>
                  <b>
                    {money(o.price)}
                    <small>/bó</small>
                  </b>
                </span>
              </label>
            ))}
          </div>
          {!eligible.length && (
            <p className="notice">
              Chưa có mẫu phù hợp. Thử bỏ bớt loài hoa cần tránh hoặc liên hệ
              cửa hàng.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
