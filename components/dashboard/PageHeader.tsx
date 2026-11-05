"use client";

import { motion } from "framer-motion";
import { EASE } from "@/components/landing/motion";
import { FlowLabel } from "@/components/flow/ui";

/**
 * The opening of a cream dashboard page: a small mono eyebrow, then a display heading whose last
 * words turn to the serif italic, the same voice as the overview's greeting. Actions sit to the
 * right on wide screens and drop under the heading on a phone.
 */
export function PageHeader({
  eyebrow,
  title,
  italic,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  italic?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="flex flex-col gap-5 pt-2 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0">
        <FlowLabel>{eyebrow}</FlowLabel>
        <h1 className="lp-display mt-2 text-balance text-[clamp(34px,5vw,56px)] leading-[0.95] tracking-[-0.045em]">
          {title}
          {italic && (
            <>
              {" "}
              <span className="lp-serif tracking-[-0.02em]">{italic}</span>
            </>
          )}
        </h1>
        {subtitle && <p className="mt-3 max-w-[520px] text-[15px] leading-[1.5] text-[var(--lp-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </motion.header>
  );
}
