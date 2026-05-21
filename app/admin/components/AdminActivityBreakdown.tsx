import { Activity } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

interface AdminActivityBreakdownProps {
  metrics: {
    totalDeposits: number;
    totalWithdrawals: number;
    totalTransfers: number;
    totalBridges?: number;
  };
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

export function AdminActivityBreakdown({ metrics, isLoading }: AdminActivityBreakdownProps) {
  const subMetrics = [
    {
      label: 'Deposits',
      value: metrics.totalDeposits || 0,
      color: '#00e87a',
    },
    {
      label: 'Withdrawals',
      value: metrics.totalWithdrawals || 0,
      color: '#f87171',
    },
    {
      label: 'Transfers',
      value: metrics.totalTransfers || 0,
      color: '#60a5fa',
    },
    {
      label: 'Bridges',
      value: metrics.totalBridges || 0,
      color: '#a855f7',
    },
  ];

  const totalBreakdown = subMetrics.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
  const chartData = subMetrics
    .map((m) => ({
      name: m.label,
      value: Number(m.value) || 0,
      color: m.color,
    }))
    .filter((d) => d.value > 0);

  const displayData =
    chartData.length > 0
      ? chartData
      : [{ name: 'No Data', value: 1, color: 'rgba(255,255,255,0.05)' }];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-white/30" />
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">
          Activity Breakdown
        </h3>
      </div>
      <div className="card-glass p-8 lg:p-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="h-[320px] relative">
            {isLoading ? (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white/10" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={displayData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {displayData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(10,10,10,0.9)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                    }}
                    itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                    formatter={(value) => [`$${Number(value || 0).toLocaleString()}`, 'Volume']}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {!isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Total</p>
                <p className="text-xl font-display font-bold text-white tracking-tight">
                  ${totalBreakdown.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {subMetrics.map((item) => {
              const val =
                item.label === 'Deposits'
                  ? metrics.totalDeposits
                  : item.label === 'Withdrawals'
                    ? metrics.totalWithdrawals
                    : item.label === 'Transfers'
                      ? metrics.totalTransfers
                      : metrics.totalBridges || 0;
              const percentage = totalBreakdown > 0 ? (val / totalBreakdown) * 100 : 0;

              return (
                <div
                  key={item.label}
                  className="group p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-sm font-bold text-white/60 group-hover:text-white transition-colors">
                        {item.label}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">
                        ${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] font-medium text-white/20 uppercase tracking-widest">
                        {percentage.toFixed(1)}% share
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
