"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function PwaCard() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null),
    [installed, setInstalled] = useState(false),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const listener = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", listener);
    navigator.serviceWorker?.getRegistration().then((r) => {
      if (r?.waiting) setWaiting(r.waiting);
    });
    return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  return (
    <section className="policy-box" style={{ marginTop: 25 }}>
      <h2 style={{ fontSize: 27 }}>Một góc hoa, trên màn hình của bạn.</h2>
      <p>
        {installed
          ? "Bạn đang dùng Fleurious như một ứng dụng."
          : "Trên iPhone: mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính. Trên Android: chọn Cài đặt ứng dụng trong menu trình duyệt hoặc nút bên dưới."}
      </p>
      {prompt && !installed && (
        <button
          className="button secondary"
          onClick={async () => {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") setInstalled(true);
            setPrompt(null);
          }}
        >
          <Download size={17} />
          Cài Fleurious
        </button>
      )}
      {waiting && (
        <button
          className="button secondary"
          onClick={() => {
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => window.location.reload(),
              { once: true },
            );
            waiting.postMessage("SKIP_WAITING");
          }}
        >
          <RefreshCw size={16} />
          Cập nhật giao diện
        </button>
      )}
    </section>
  );
}
