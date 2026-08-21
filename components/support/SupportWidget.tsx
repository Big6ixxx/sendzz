"use client";

/**
 * Support: a curated answer list with a human behind it.
 *
 * There is no text box, on purpose. This answers questions about money that has already left
 * someone's wallet, and a plausible-sounding invention there is worse than no answer at all. A
 * fixed list also tells people up front what we can help with, instead of inviting someone in a
 * panic to type a question we were never going to answer.
 *
 * The Telegram route sits in the list rather than behind a failed answer: someone whose payout
 * has not arrived should not have to work through software first to reach a person.
 */

import { FAQ_SECTIONS } from "@/lib/support/faq";
import { cn } from "@/lib/utils";
import { ChevronDown, HelpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Configurable without a deploy — a support group link can change. */
const TELEGRAM_URL =
  process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL || "https://t.me/sendzz";

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Escape closes it, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* ─── Launcher ─────────────────────────────────────────────── */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close support" : "Open support"}
          aria-expanded={open}
          className={cn(
            "flex items-center justify-center w-12 h-12 rounded-full",
            "shadow-lg transition-all duration-200 hover:scale-105 active:scale-95",
          )}
          style={{
            background: open ? "rgba(28,28,30,0.95)" : "#00e87a",
            color: open ? "rgba(248,248,246,0.7)" : "#04120a",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: open ? undefined : "0 8px 24px rgba(0,232,122,0.28)",
          }}
        >
          {open ? <X className="w-5 h-5" /> : <HelpCircle className="w-6 h-6" />}
        </button>
        <span
          className="text-[9.5px] font-black uppercase tracking-[0.14em] pointer-events-none select-none"
          style={{
            color: open ? "rgba(248,248,246,0.35)" : "rgba(0,232,122,0.85)",
            textShadow: "0 1px 6px rgba(0,0,0,0.6)",
          }}
        >
          Support
        </span>
      </div>

      {/* ─── Panel ────────────────────────────────────────────────── */}
      {open && (
        <div
          role="dialog"
          aria-label="Support"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl",
            "bottom-24 right-5 w-[calc(100vw-2.5rem)] sm:w-97.5",
            "max-h-[min(600px,calc(100vh-9rem))]",
            "animate-in fade-in slide-in-from-bottom-4 duration-300",
          )}
          style={{
            background: "rgba(18,18,20,0.98)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(12px)",
          }}
        >
          <header
            className="px-4 py-3.5 shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full animate-beacon"
                style={{ background: "#00e87a" }}
              />
              <span className="text-[13.5px] font-black tracking-tight">
                How can we help?
              </span>
            </div>
            <p
              className="text-[10.5px] mt-1"
              style={{ color: "rgba(248,248,246,0.35)" }}
            >
              Pick a question below, or message our team directly.
            </p>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            {FAQ_SECTIONS.map((section) => (
              <div key={section.title} className="space-y-1">
                <p
                  className="px-2 pb-1 text-[9.5px] font-black uppercase tracking-[0.14em]"
                  style={{ color: "rgba(248,248,246,0.28)" }}
                >
                  {section.title}
                </p>

                {section.entries.map((entry) => {
                  const isOpen = expanded === entry.id;
                  return (
                    <div key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : entry.id)}
                        aria-expanded={isOpen}
                        className="w-full flex items-start gap-2 px-2.5 py-2.5 rounded-xl text-left transition-colors hover:bg-white/4"
                        style={{
                          background: isOpen ? "rgba(255,255,255,0.04)" : undefined,
                        }}
                      >
                        <span
                          className="flex-1 text-[12.5px] font-medium leading-snug"
                          style={{
                            color: isOpen ? "#f8f8f6" : "rgba(248,248,246,0.72)",
                          }}
                        >
                          {entry.question}
                        </span>
                        <ChevronDown
                          className={cn(
                            "w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200",
                            isOpen && "rotate-180",
                          )}
                          style={{ color: "rgba(248,248,246,0.3)" }}
                        />
                      </button>

                      {isOpen && (
                        <p
                          className="px-2.5 pb-3 pt-0.5 text-[12px] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200"
                          style={{ color: "rgba(248,248,246,0.6)" }}
                        >
                          {entry.answer}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* ── A person, in the list rather than behind a dead end ── */}
            <div className="pt-1">
              <p
                className="px-2 pb-1 text-[9.5px] font-black uppercase tracking-[0.14em]"
                style={{ color: "rgba(248,248,246,0.28)" }}
              >
                Still need help?
              </p>
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-3 rounded-xl transition-transform hover:scale-[1.015]"
                style={{
                  background: "rgba(0,232,122,0.1)",
                  border: "1px solid rgba(0,232,122,0.2)",
                }}
              >
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(0,232,122,0.15)" }}
                >
                  <TelegramMark />
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-[12.5px] font-bold"
                    style={{ color: "#00e87a" }}
                  >
                    Message someone from Sendzz
                  </span>
                  <span
                    className="block text-[10.5px] mt-0.5"
                    style={{ color: "rgba(248,248,246,0.4)" }}
                  >
                    Chat with a real person on Telegram
                  </span>
                </span>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Telegram's mark is not in lucide. */
function TelegramMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="#00e87a"
      aria-hidden="true"
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
