"use client";

import { useEffect } from "react";

// Animate content blocks, not their layout containers or nested copies of a block.
const blocks = [
  ".client-page section > *",
  ".client-page article",
  ".client-page .checkout-layout > *",
  ".client-page .streak-layout > *",
  ".client-page .account-cards > *",
  ".client-page .circle-plans > *",
  ".client-page .circle-account-sections > *",
  ".client-page .inbox-item",
  ".client-page .customer-order-wrap",
  ".client-page .detail-block",
  ".client-page .order-status-banner",
  ".client-page .tracking-result > *",
  ".client-page .content-page > div > *",
  ".client-page [data-scroll-fade]",
  ".closing-note > *",
  ".footer > *",
].join(",");

/** One observer also handles async content, route changes and infinite scrolling. */
export function ClientScrollEffects() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    if (!("animate" in Element.prototype)) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const printing = window.matchMedia("print");
    let stop = () => {};
    const start = () => {
      stop();
      if (preference.matches || printing.matches) return;
      const targets = new Map<
        HTMLElement,
        {
          visible: boolean | undefined;
          animation: Animation | null;
        }
      >();
      let frame = 0;
      let disposed = false;
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 24 && rect.top < window.innerHeight - 40;
      };
      const show = (
        element: HTMLElement,
        visible: boolean,
        immediate = false,
      ) => {
        const state = targets.get(element);
        if (!state) return;
        visible ||= element.contains(document.activeElement);
        if (state.visible === visible && !immediate) return;
        const from = getComputedStyle(element).opacity;
        state.animation?.cancel();
        state.animation = null;
        state.visible = visible;
        // WAAPI changes the rendered appearance without writing attributes/styles
        // into server HTML that a deferred React/Suspense boundary may still hydrate.
        if (visible && immediate) return;
        const to = visible ? getComputedStyle(element).opacity : "0";
        const animation = element.animate(
          [{ opacity: from }, { opacity: to }],
          {
            duration: immediate ? 0 : 360,
            easing: "ease-in-out",
            fill: "forwards",
          },
        );
        state.animation = animation;
        if (visible)
          animation.onfinish = () => {
            if (state.animation === animation) {
              animation.cancel();
              state.animation = null;
            }
          };
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const element = entry.target as HTMLElement;
            if (targets.has(element)) show(element, entry.isIntersecting);
          }
        },
        { rootMargin: "-24px 0px -40px 0px", threshold: 0 },
      );
      const clear = (element: HTMLElement) => {
        observer.unobserve(element);
        targets.get(element)?.animation?.cancel();
        targets.delete(element);
      };
      const sync = () => {
        if (disposed) return;
        const candidates = new Set(
          Array.from(document.querySelectorAll<HTMLElement>(blocks)).filter(
            (element) =>
              element instanceof HTMLElement &&
              !element.matches(
                "script, style, template, input, select, textarea",
              ) &&
              !element.closest(
                'dialog, [role="dialog"], [data-scroll-fade="off"]',
              ) &&
              !element.querySelector(blocks) &&
              !["fixed", "sticky"].includes(getComputedStyle(element).position),
          ),
        );
        for (const element of targets.keys()) {
          if (!candidates.has(element)) clear(element);
        }
        for (const element of candidates) {
          if (targets.has(element)) continue;
          targets.set(element, { visible: undefined, animation: null });
          show(element, isVisible(element), true);
          observer.observe(element);
        }
      };
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(sync);
      };
      const focus = (event: FocusEvent) => {
        for (const element of targets.keys()) {
          if (event.target instanceof Node && element.contains(event.target))
            show(element, true, true);
        }
      };
      const mutations = new MutationObserver((records) => {
        if (
          records.some((record) =>
            [...record.addedNodes, ...record.removedNodes].some(
              (node) => node instanceof Element,
            ),
          )
        )
          schedule();
      });
      mutations.observe(document.getElementById("main-content")!, {
        childList: true,
        subtree: true,
      });
      document.addEventListener("focusin", focus);
      sync();
      stop = () => {
        disposed = true;
        cancelAnimationFrame(frame);
        mutations.disconnect();
        observer.disconnect();
        document.removeEventListener("focusin", focus);
        for (const state of targets.values()) state.animation?.cancel();
        targets.clear();
      };
    };
    start();
    const beforePrint = () => stop();
    preference.addEventListener("change", start);
    printing.addEventListener("change", start);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", start);
    return () => {
      preference.removeEventListener("change", start);
      printing.removeEventListener("change", start);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", start);
      stop();
    };
  }, []);
  return null;
}
