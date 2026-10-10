"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TelegramMark } from "@/components/support/SupportWidget";
import { TELEGRAM_URL } from "@/lib/social";
import { FAQ_SECTIONS } from "@/lib/support/faq";
import { EASE, MEDIA, useMedia } from "./motion";

/**
 * The support widget in the landing page's light style. Same answers and the same Telegram
 * route as the dashboard's dark one (components/support/SupportWidget.tsx) — only the dress
 * differs.
 */
export function LandingSupport() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const reduce = useMedia(MEDIA.reduce);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close support" : "Open support"}
          aria-expanded={open}
          className={`grid size-[52px] place-items-center rounded-full transition-[scale,background-color] duration-150 active:scale-[0.94] ${
            open
              ? "bg-[var(--lp-ink)] text-[var(--lp-green)]"
              : "bg-[var(--lp-green)] text-[var(--lp-ink)] shadow-[0_14px_30px_-12px_rgb(0_60_30/0.55)] hover:scale-105"
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? "close" : "open"}
              initial={{ opacity: 0, rotate: reduce ? 0 : -60, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: reduce ? 0 : 60, scale: 0.6 }}
              transition={{ duration: 0.18 }}
              className="grid place-items-center"
            >
              {open ? <X className="size-5" strokeWidth={2.4} /> : <HelpCircle className="size-6" strokeWidth={2.2} />}
            </motion.span>
          </AnimatePresence>
        </button>
        <span className="lp-mono pointer-events-none select-none rounded-full bg-[rgba(246,242,233,0.9)] px-2 py-0.5 text-[10.5px] uppercase tracking-[0.08em] text-[var(--lp-ink)]">
          Support
        </span>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Support"
            initial={{ opacity: 0, y: reduce ? 0 : 16, scale: reduce ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduce ? 0 : 12, scale: reduce ? 1 : 0.97, transition: { duration: 0.15 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="fixed bottom-[104px] right-5 z-50 flex max-h-[min(600px,calc(100dvh-9rem))] w-[calc(100vw-2.5rem)] origin-bottom-right flex-col overflow-hidden rounded-[28px] bg-white text-[var(--lp-ink)] shadow-[0_24px_48px_-20px_rgb(17_26_19/0.35),0_0_0_1px_rgb(17_26_19/0.06)] sm:w-[400px]"
          >
            <header className="shrink-0 border-b border-[#e3dcce] px-6 pb-4 pt-5">
              <div className="flex items-center gap-2.5">
                <span className="lp-pulse size-2 rounded-full bg-[var(--lp-green)]" />
                <h2 className="lp-display text-[22px] font-semibold tracking-[-0.02em]">How can we help?</h2>
              </div>
              <p className="mt-1 text-[14px] leading-5 text-[var(--lp-muted)]">
                Pick a question below, or message our team directly.
              </p>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
              {FAQ_SECTIONS.map((section) => (
                <div key={section.title}>
                  <p className="lp-mono px-3 pb-2 text-[12px] uppercase text-[var(--lp-muted)]">{section.title}</p>
                  <div className="flex flex-col gap-1">
                    {section.entries.map((entry) => {
                      const isOpen = expanded === entry.id;
                      return (
                        <div
                          key={entry.id}
                          className={`rounded-[18px] transition-colors duration-200 ${isOpen ? "bg-[var(--lp-cream)]" : "hover:bg-[rgba(246,242,233,0.6)]"}`}
                        >
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : entry.id)}
                            aria-expanded={isOpen}
                            className="flex w-full items-center gap-3 px-3 py-3 text-left"
                          >
                            <span className="flex-1 text-[15px] font-semibold leading-snug">{entry.question}</span>
                            <span className="relative grid size-7 flex-none place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-green)]">
                              <span className="absolute h-0.5 w-3 rounded-full bg-current" />
                              <span
                                className={`absolute h-3 w-0.5 rounded-full bg-current transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? "scale-y-0" : ""}`}
                              />
                            </span>
                          </button>
                          <div
                            inert={!isOpen}
                            className={`grid transition-[grid-template-rows] duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                          >
                            <div className="overflow-hidden">
                              <p
                                className={`px-3 pb-3.5 text-[14px] leading-[1.6] text-[var(--lp-body)] transition-opacity ease-out ${isOpen ? "opacity-100 duration-300" : "opacity-0 duration-150"}`}
                              >
                                {entry.answer}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div>
                <p className="lp-mono px-3 pb-2 text-[12px] uppercase text-[var(--lp-muted)]">Still need help?</p>
                <a
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-[20px] bg-[var(--lp-green)] px-4 py-3.5 transition-[scale] duration-150 active:scale-[0.98]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--lp-ink)]">
                    <TelegramMark />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">Message someone from Sendzz</span>
                    <span className="block text-[13px] text-[rgba(17,26,19,0.7)]">Chat with a real person on Telegram</span>
                  </span>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
