import { BarChart3, Users } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

interface AdminChartsProps {
  analytics: Array<{ date: string; volume: number; users: number }> | undefined;
  isLoading: boolean;
}

function Loader2({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );
}

export function AdminCharts({ analytics, isLoading }: AdminChartsProps) {
  return (
    <div className="grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-white/30" />
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">
              Transaction Volume
            </h3>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-bold text-white/20 uppercase tracking-widest">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-accent" />
              Volume (USDC)
            </div>
          </div>
        </div>

        <div className="card-glass p-8 h-[400px]">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-white/10 animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics || []}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00e87a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00e87a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  stroke="rgba(255,255,255,0.2)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val: string | number | Date) =>
                    new Date(val).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  }
                />
                <YAxis
                  stroke="rgba(255,255,255,0.2)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val: number) => `$${val}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(10,10,10,0.9)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                  }}
                  itemStyle={{
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 'bold',
                  }}
                  labelStyle={{
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: '10px',
                    marginBottom: '4px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#00e87a"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorVolume)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-white/30" />
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">
            User Onboarding
          </h3>
        </div>
        <div className="card-glass p-8 h-[400px]">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-white/10 animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics || []}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  stroke="rgba(255,255,255,0.2)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val: string | number | Date) =>
                    new Date(val).toLocaleDateString(undefined, {
                      day: 'numeric',
                    })
                  }
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{
                    backgroundColor: 'rgba(10,10,10,0.9)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                  }}
                />
                <Bar dataKey="users" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
