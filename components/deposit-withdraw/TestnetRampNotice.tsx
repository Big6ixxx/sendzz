import { AlertTriangle } from 'lucide-react';

/**
 * Explains why the deposit/withdraw button is disabled.
 *
 * The fiat providers stay live even when the chains are testnet, so both ramps are
 * switched off in simulation mode. Without this the button would just look broken —
 * the point is to say plainly that it is the network, not a failure.
 *
 * Renders nothing when the ramp is available, so call sites can drop it in
 * unconditionally.
 */
export function TestnetRampNotice({
  show,
  message,
}: {
  show: boolean;
  message: string;
}) {
  if (!show) return null;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-xs leading-relaxed">{message}</p>
    </div>
  );
}
