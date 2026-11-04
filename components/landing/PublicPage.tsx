import { LandingFooter, PublicHeader } from "@/components/landing/Chrome";
import { DotField } from "@/components/landing/DotField";
import "@/components/landing/landing.css";

/**
 * Every public page that is not the landing page: the landing's moving dot field behind, then
 * the header, the content and the footer above it, as on the landing page.
 */
export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-root relative min-h-screen overflow-x-clip">
      <DotField />
      <div className="relative">
        <PublicHeader />
        <main className="mx-auto w-full max-w-[1360px] px-4 pb-24 pt-10 md:px-7 md:pt-16">{children}</main>
        <LandingFooter />
      </div>
    </div>
  );
}
