"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isStandalonePwa } from "@/lib/pwa-display";

/** Restrict page zoom only in the installed app; ordinary browser tabs retain zoom. */
export function PwaViewport() {
  const pathname = usePathname();
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const root = document.documentElement;
    const viewport = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]',
    );
    const original = viewport?.content;
    let installed = false;
    const update = () => {
      installed = isStandalonePwa();
      if (installed) {
        root.dataset.pwaStandalone = "true";
        if (viewport) {
          const base = (
            original ??
            "width=device-width, initial-scale=1, viewport-fit=cover"
          )
            .split(",")
            .filter(
              (value) =>
                !/^(maximum-scale|minimum-scale|user-scalable)\s*=/.test(
                  value.trim(),
                ),
            );
          viewport.content = [
            ...base,
            "maximum-scale=1",
            "user-scalable=no",
          ].join(", ");
        }
      } else {
        delete root.dataset.pwaStandalone;
        if (viewport && original !== undefined) viewport.content = original;
      }
    };
    const preventGesture = (event: Event) => {
      if (installed && event.cancelable) event.preventDefault();
    };
    const preventPinch = (event: TouchEvent) => {
      if (installed && event.touches.length > 1 && event.cancelable)
        event.preventDefault();
    };
    const preventTrackpadZoom = (event: WheelEvent) => {
      if (installed && event.ctrlKey && event.cancelable)
        event.preventDefault();
    };
    update();
    mode.addEventListener("change", update);
    document.addEventListener("gesturestart", preventGesture, {
      passive: false,
    });
    document.addEventListener("gesturechange", preventGesture, {
      passive: false,
    });
    document.addEventListener("touchmove", preventPinch, { passive: false });
    document.addEventListener("wheel", preventTrackpadZoom, { passive: false });
    return () => {
      mode.removeEventListener("change", update);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("touchmove", preventPinch);
      document.removeEventListener("wheel", preventTrackpadZoom);
      delete root.dataset.pwaStandalone;
      if (viewport && original !== undefined) viewport.content = original;
    };
  }, [pathname]);
  return null;
}
