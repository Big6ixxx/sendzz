import { Sparkles } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50 flex flex-col items-center justify-center">
      <div className="relative">
        {/* Pulsing background */}
        <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />

        {/* Logo container */}
        <div className="w-16 h-16 bg-linear-to-br from-blue-600 to-violet-600 rounded-2xl flex items-center justify-center shadow-lg relative z-10 animate-bounce-subtle">
          <Sparkles className="w-8 h-8 text-white animate-spin-slow" />
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-2">
        <h2 className="text-2xl font-black tracking-tight bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent animate-pulse">
          SENDZZ
        </h2>
        <p className="text-muted-foreground text-sm font-medium animate-pulse">
          Loading your financial world...
        </p>
      </div>
    </div>
  );
}
