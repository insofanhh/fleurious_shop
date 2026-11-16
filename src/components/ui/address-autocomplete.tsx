"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MapPin, LoaderCircle, Check } from "lucide-react";
import { request } from "../shop-provider";
import type { AddressSelection } from "@/lib/shipping-types";
import "./address-autocomplete.css";
type Suggestion = {
  placeId: string;
  address: string;
  main: string;
  secondary: string;
};
export function AddressAutocomplete({
  value,
  onChange,
  selection,
  onSelect,
  label = "Địa điểm giao hoa",
  name = "address",
  enabled = true,
  requireSelection = false,
  required = true,
  showDataNote = true,
}: {
  value: string;
  onChange: (value: string) => void;
  selection: AddressSelection | null;
  onSelect: (point: AddressSelection | null) => void;
  label?: string;
  name?: string;
  enabled?: boolean;
  requireSelection?: boolean;
  required?: boolean;
  showDataNote?: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    epoch = useRef(0);
  const [results, setResults] = useState<{
      query: string;
      items: Suggestion[];
    } | null>(null),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [loading, setLoading] = useState(false),
    [choosing, setChoosing] = useState(false),
    [error, setError] = useState("");
  const items = results?.query === value ? results.items : [];
  useEffect(
    () => () => {
      ++epoch.current;
    },
    [],
  );
  useEffect(() => {
    ++epoch.current;
    setChoosing(false);
  }, [value, selection]);
  useEffect(() => {
    input.current?.setCustomValidity(
      requireSelection && !selection
        ? "Vui lòng chọn địa điểm từ danh sách gợi ý."
        : "",
    );
  }, [requireSelection, selection]);
  useEffect(() => {
    if (!enabled || value.trim().length < 4 || selection?.address === value) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/locations/autocomplete", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: value }),
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error ?? "Chưa tìm được địa chỉ.");
        if (alive) {
          setResults({ query: value, items: data });
          setActive(-1);
        }
      } catch (e) {
        if (alive && !controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, enabled, selection]);
  async function choose(item: Suggestion) {
    const current = ++epoch.current;
    setChoosing(true);
    setError("");
    setOpen(false);
    try {
      const point = await request<AddressSelection>("locations/resolve", {
        placeId: item.placeId,
      });
      if (epoch.current === current) {
        onChange(point.address);
        onSelect(point);
        setResults(null);
      }
    } catch (e) {
      if (epoch.current === current) setError((e as Error).message);
    } finally {
      if (epoch.current === current) setChoosing(false);
    }
  }
  return (
    <div
      className="address-autocomplete"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="address-input-wrap">
        <MapPin size={17} aria-hidden="true" />
        <input
          ref={input}
          id={id}
          name={name}
          value={value}
          maxLength={500}
          minLength={required ? 8 : undefined}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && enabled && !selection}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && active >= 0 ? `${id}-${active}` : undefined
          }
          placeholder="Số nhà, đường, phường hoặc tên địa điểm…"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            ++epoch.current;
            setChoosing(false);
            setActive(-1);
            onSelect(null);
            onChange(event.target.value);
            setOpen(true);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (!open || !items.length) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(
                (value) =>
                  (value +
                    (event.key === "ArrowDown" ? 1 : items.length - 1) +
                    items.length) %
                  items.length,
              );
            }
            if (event.key === "Enter" && active >= 0 && items[active]) {
              event.preventDefault();
              void choose(items[active]);
            }
          }}
        />
        {loading || choosing ? (
          <LoaderCircle
            size={16}
            className="address-spinner"
            aria-label="Đang tìm địa chỉ"
          />
        ) : selection ? (
          <Check size={16} aria-label="Địa điểm đã xác nhận" />
        ) : null}
      </div>
      {open && enabled && !selection && value.trim().length >= 4 && (
        <div
          className="address-suggestions"
          role="listbox"
          id={`${id}-list`}
          aria-label="Địa chỉ gợi ý"
        >
          {items.map((item, index) => (
            <button
              key={item.placeId}
              id={`${id}-${index}`}
              role="option"
              aria-selected={active === index}
              type="button"
              className={active === index ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              <MapPin size={16} aria-hidden="true" />
              <span>
                <strong>{item.main}</strong>
                <small>{item.secondary || item.address}</small>
              </span>
            </button>
          ))}
          {!items.length && !loading && !error && (
            <p>Chưa tìm thấy. Thử thêm tên đường hoặc phường.</p>
          )}
          {loading && !items.length && <p role="status">Đang tìm địa chỉ…</p>}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {selection && (
        <small className="address-confirmed">Đã xác nhận địa điểm giao.</small>
      )}
      {enabled && showDataNote && (
        <small className="address-data-note">
          Địa chỉ tìm kiếm được gửi tới Goong để xác định vị trí.
        </small>
      )}
    </div>
  );
}
