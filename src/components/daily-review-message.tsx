"use client";
import { useEffect, useState, useCallback } from "react";
import { MessageCircle, PencilLine, Save, X } from "lucide-react";

export function DailyReviewMessage({
  day,
  message,
  handwritten,
  updating,
  disabled,
  onSave,
  onEditingChange,
}: {
  day: string;
  message: string;
  handwritten: boolean;
  updating: boolean;
  disabled: boolean;
  onSave: (message: string) => void;
  onEditingChange: (day: string, editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [preview, setPreview] = useState<string | null>(null);
  const date = day.split("-").reverse().join("/");
  useEffect(() => {
    if (!updating) setPreview(null);
  }, [updating, message]);
  useEffect(() => () => onEditingChange(day, false), [day, onEditingChange]);
  const finish = useCallback(() => {
    setEditing(false);
    onEditingChange(day, false);
  }, [day, onEditingChange]);
  const save = () => {
    if (disabled) return;
    setPreview(draft.trim() ? draft : "Đang lấy lời chúc tự động…");
    onSave(draft);
    finish();
  };
  return (
    <div className={`daily-review-message${editing ? " editing" : ""}`}>
      <div className="daily-message-heading">
        <span className="daily-review-label">
          <MessageCircle size={14} aria-hidden="true" />
          {handwritten ? "Lời nhắn để viết tay" : "Lời nhắn trên thiệp"}
        </span>
        <div className="daily-message-actions">
          {editing ? (
            <>
              <button
                type="button"
                className="daily-message-action save"
                disabled={disabled}
                aria-label={`Lưu lời chúc ngày ${date}`}
                title="Lưu lời chúc"
                onClick={save}
              >
                <Save size={15} />
              </button>
              <button
                type="button"
                className="daily-message-action"
                disabled={disabled}
                aria-label={`Hủy sửa lời chúc ngày ${date}`}
                title="Hủy chỉnh sửa"
                onClick={finish}
              >
                <X size={15} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="daily-message-action"
              disabled={disabled || (updating && preview !== null)}
              aria-label={`Sửa lời chúc ngày ${date}`}
              title="Sửa lời chúc"
              onClick={() => {
                setDraft(preview ?? message);
                setEditing(true);
                onEditingChange(day, true);
              }}
            >
              <PencilLine size={15} />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            rows={4}
            maxLength={800}
            value={draft}
            disabled={disabled}
            aria-label={`Lời chúc ngày ${date}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                finish();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
            }}
          />
          <div className="daily-message-editor-hint">
            <span>Để trống để dùng lời chúc tự động.</span>
            <span>{draft.length}/800</span>
          </div>
        </>
      ) : (
        <p>{preview ?? message}</p>
      )}
    </div>
  );
}
