"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { isStandalonePwa } from "@/lib/pwa-display";
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function PwaCard() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null),
    [installed, setInstalled] = useState(false),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const checkUpdate = () => {
      if (active && registration?.waiting) setWaiting(registration.waiting);
    };
    const watchUpdate = () => {
      installing?.removeEventListener("statechange", checkUpdate);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", checkUpdate);
      checkUpdate();
    };
    setInstalled(isStandalonePwa());
    const listener = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", listener);
    navigator.serviceWorker?.getRegistration().then((r) => {
      if (!active || !r) return;
      registration = r;
      registration.addEventListener("updatefound", watchUpdate);
      watchUpdate();
    });
    return () => {
      active = false;
      registration?.removeEventListener("updatefound", watchUpdate);
      installing?.removeEventListener("statechange", checkUpdate);
      window.removeEventListener("beforeinstallprompt", listener);
    };
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
