/**
 * A legal document in the cream brand (Figma: Privacy policy, Terms of service): the large
 * two-part heading, "On this page", numbered sections, and a forest card to the other document.
 * Each page is only its content, written with the small pieces below.
 */

import { DocBody, DocHeader, DocReadNext, DocSection } from "@/components/dashboard/DocLayout";
import { PublicPage } from "@/components/landing/PublicPage";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

export function LegalPage({
  title,
  italic,
  lead,
  updated,
  sections,
  next,
}: {
  title: string;
  italic: string;
  lead: string;
  updated: string;
  sections: LegalSection[];
  next: { title: string; body: string; href: string };
}) {
  return (
    <PublicPage>
      <DocHeader eyebrow="Legal" title={title} italic={italic} lead={lead} meta={`Last updated ${updated}`} />
      <div className="mt-12 lg:mt-20">
        <DocBody items={sections.map((s) => ({ id: s.id, label: s.title }))}>
          {sections.map((s, i) => (
            <DocSection key={s.id} id={s.id} number={i + 1} title={s.title}>
              <div className="space-y-5 text-[17px] leading-[1.65] text-[var(--lp-body)]">{s.body}</div>
            </DocSection>
          ))}
          <DocReadNext title={next.title} body={next.body} href={next.href} />
        </DocBody>
      </div>
    </PublicPage>
  );
}

/** A sub-heading inside a section. */
export function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-[17px] font-semibold text-[var(--lp-ink)]">{children}</h3>;
}

/** A bulleted list; an item may open with a bold lead-in. */
export function Bullets({ items }: { items: (string | [lead: string, rest: string])[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6 marker:text-[var(--lp-muted)]">
      {items.map((item) => (
        <li key={typeof item === "string" ? item : item[0]} className="pl-1">
          {typeof item === "string" ? (
            item
          ) : (
            <>
              <strong className="font-semibold text-[var(--lp-ink)]">{item[0]}</strong>
              {item[1]}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A bold lead-in at the start of a paragraph. */
export function Lead({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[var(--lp-ink)]">{children}</strong>;
}

/** A detail still to be filled in, highlighted so it cannot be missed before launch. */
export function Blank({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded-[6px] bg-[var(--lp-mark)] px-1.5 py-0.5 text-[var(--lp-ink)] [box-decoration-break:clone]">[{children}]</mark>
  );
}
