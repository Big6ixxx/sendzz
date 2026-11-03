import { brandFontVars } from "@/components/landing/fonts";
import { LandingFooter, PublicHeader } from "@/components/landing/Chrome";
import "@/components/landing/landing.css";

/** Every public page that is not the landing page: the cream header, the content, the footer. */
export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lp-root ${brandFontVars} min-h-screen`}>
      <PublicHeader />
      <main className="relative mx-auto w-full max-w-[1360px] px-4 pb-24 pt-10 md:px-7 md:pt-16">{children}</main>
      <LandingFooter />
    </div>
  );
}
