"use client";
import { useId, useRef, useState } from "react";
import { ImagePlus, Upload, X, Check } from "lucide-react";

export function ImageUpload({
  value,
  onChange,
  label = "Ảnh",
  required = false,
  onBusyChange,
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  required?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false);
  const [error, setError] = useState(""),
    [fileName, setFileName] = useState("");
  const inFlight = useRef(false);
  async function upload(file?: File) {
    if (!file || inFlight.current) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Chọn ảnh JPG, PNG hoặc WebP.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Ảnh tối đa 4 MB.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/media", {
        method: "POST",
        body,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Chưa thể tải ảnh. Vui lòng thử lại.");
      onChange(result.url);
      setFileName(file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="image-upload-field">
      <label htmlFor={`${id}-url`}>{label}</label>
      <div
        className="image-upload-card"
        data-dragging={dragging || undefined}
        aria-busy={busy}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="image-upload-preview">
          {value ? (
            <img src={value} alt="Ảnh đang chọn" />
          ) : (
            <ImagePlus size={30} strokeWidth={1.3} />
          )}
        </div>
        <div className="image-upload-copy">
          <strong>
            {busy ? "Đang tải và tối ưu ảnh…" : "Chọn ảnh hoặc kéo thả vào đây"}
          </strong>
          <p>JPG, PNG, WebP · tối đa 4 MB</p>
          <div className="image-upload-actions">
            <label
              className="button secondary"
              htmlFor={`${id}-file`}
              aria-disabled={busy}
            >
              <Upload size={15} /> {value ? "Đổi ảnh" : "Chọn ảnh"}
              <input
                id={`${id}-file`}
                className="file-input-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {value && (
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  onChange("");
                  setFileName("");
                }}
              >
                <X size={14} /> Bỏ ảnh
              </button>
            )}
          </div>
          {fileName && !busy && (
            <span className="image-upload-success">
              <Check size={13} /> {fileName}
            </span>
          )}
        </div>
      </div>
      <label className="image-upload-url" htmlFor={`${id}-url`}>
        Hoặc dùng đường dẫn ảnh
        <input
          id={`${id}-url`}
          name="image"
          value={value}
          required={required}
          disabled={busy}
          placeholder="https://… hoặc /images/…"
          onChange={(e) => {
            onChange(e.target.value);
            setFileName("");
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
