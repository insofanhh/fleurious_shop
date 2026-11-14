"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, ScanLine, X } from "lucide-react";
import type { IScannerControls } from "@zxing/browser";
import { streakQrPath } from "@/lib/qr-link";

export function StreakScanner() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="streak-camera glass-primary"
        aria-label="Quét QR giữ chuỗi"
        title="Quét QR giữ chuỗi"
        onClick={() => setOpen(true)}
      >
        <Camera size={24} strokeWidth={1.6} />
        <span>Quét QR</span>
      </button>
      {open && <ScannerDialog close={() => setOpen(false)} />}
    </>
  );
}
function ScannerDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const router = useRouter();
  const [error, setError] = useState(""),
    [status, setStatus] = useState("Đang mở camera…"),
    [link, setLink] = useState(""),
    [retry, setRetry] = useState(0);
  const navigating = useRef(false);
  function stop() {
    controls.current?.stop();
    controls.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  function accept(raw: string) {
    const path = streakQrPath(raw, window.location.origin);
    if (!path) {
      setError(
        "Đây chưa phải QR giữ chuỗi của Fleurious. Hãy dùng mã trong đơn hoa, không dùng QR thanh toán.",
      );
      return;
    }
    if (navigating.current) return;
    navigating.current = true;
    stop();
    close();
    router.push(path);
  }
  useEffect(() => {
    const target = dialog.current;
    target?.showModal();
    return () => {
      stop();
      target?.close();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        setError("");
        setStatus("Đang mở camera…");
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("CAMERA_UNAVAILABLE");
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled) return;
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 250,
          delayBetweenScanSuccess: 1000,
        });
        const scan = await reader.decodeFromStream(
          media,
          video.current!,
          (result) => {
            if (result && !cancelled) accept(result.getText());
          },
        );
        if (cancelled) {
          scan.stop();
          return;
        }
        controls.current = scan;
        setStatus("Đưa QR giữ chuỗi vào khung hình");
      } catch (e) {
        if (!cancelled) {
          stop();
          setStatus("Camera chưa sẵn sàng");
          const name = e instanceof Error ? e.name : "";
          setError(
            name === "NotAllowedError"
              ? "Bạn chưa cho phép camera. Hãy bật quyền trong trình duyệt, hoặc chọn ảnh QR / dán liên kết bên dưới."
              : "Không mở được camera. Bạn có thể chọn ảnh QR, dán liên kết hoặc quét bằng ứng dụng camera trên điện thoại.",
          );
        }
      }
    }
    start();
    const hidden = () => {
      if (document.hidden) {
        stop();
        setStatus("Camera đã tạm dừng");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [retry]);
  return (
    <dialog
      ref={dialog}
      className="scanner-dialog"
      aria-labelledby="scanner-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="scanner-heading">
        <div>
          <span className="eyebrow">MỘT NGÀY CÓ HOA</span>
          <h2 id="scanner-title">Quét mã giữ chuỗi</h2>
        </div>
        <button onClick={close} aria-label="Đóng camera">
          <X size={21} />
        </button>
      </div>
      <div className="scanner-preview">
        <video ref={video} muted playsInline autoPlay />
        <ScanLine className="scanner-frame" size={100} strokeWidth={1} />
      </div>
      <p className="scanner-status" role="status">
        {status}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="scanner-actions">
        <button
          className="button secondary"
          onClick={() => {
            stop();
            setRetry((n) => n + 1);
          }}
        >
          <Camera size={16} /> Mở lại camera
        </button>
        <label className="button secondary">
          <ImagePlus size={16} /> Chọn ảnh QR
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const url = URL.createObjectURL(file);
              try {
                const { BrowserQRCodeReader } = await import("@zxing/browser");
                const result =
                  await new BrowserQRCodeReader().decodeFromImageUrl(url);
                accept(result.getText());
              } catch {
                setError(
                  "Không đọc được QR trong ảnh. Hãy chọn ảnh rõ hơn hoặc dán liên kết.",
                );
              } finally {
                URL.revokeObjectURL(url);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          accept(link);
        }}
      >
        <label>
          Hoặc dán liên kết từ camera
          <input
            type="text"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/q/…"
            required
          />
        </label>
        <button className="button" type="submit">
          Mở ngày có hoa
        </button>
      </form>
      <p className="small muted">
        Quét mã sẽ mở trang nhận ngày hiện tại. Bạn vẫn cần đăng nhập và xác
        nhận; các điều kiện giữ chuỗi được giữ nguyên.
      </p>
    </dialog>
  );
}
