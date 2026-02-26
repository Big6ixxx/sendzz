import { Sparkles } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center overflow-hidden relative">
      {/* Aurora orbs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="aurora-orb aurora-orb-indigo w-96 h-96 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-40 animate-aurora-pulse" />
        <div
          className="aurora-orb aurora-orb-cyan w-64 h-64 top-1/3 left-1/4 opacity-25 animate-aurora-pulse"
          style={{ animationDelay: '2s' }}
        />
      </div>

      {/* Logo */}
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl blur-2xl bg-primary/40 scale-125 animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl btn-shimmer flex items-center justify-center shadow-2xl animate-float">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h2
            className="text-3xl font-extrabold tracking-tight text-aurora"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            SENDZZ
          </h2>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
