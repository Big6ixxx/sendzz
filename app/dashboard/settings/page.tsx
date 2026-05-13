'use client';

import { DashboardPageHeader } from '@/components/DashboardPageHeader';
import { usePrivy } from '@privy-io/react-auth';
import { Bell, ChevronRight, Globe, LogOut, Shield, User } from 'lucide-react';

export default function SettingsPage() {
  const { user, logout } = usePrivy();

  const sections = [
    {
      title: 'Account',
      items: [
        {
          label: 'Email',
          value: user?.email?.address || 'Not set',
          icon: User,
        },
        { label: 'Wallet', value: 'Smart Account Active', icon: Shield },
      ],
    },
    {
      title: 'Preferences',
      items: [
        { label: 'Notifications', value: 'Email only', icon: Bell },
        { label: 'Language', value: 'English (US)', icon: Globe },
      ],
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <DashboardPageHeader
        title="Settings"
        subtitle="Manage your personal account and preferences."
      />

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">
              {section.title}
            </h3>
            <div className="card-glass p-0 overflow-hidden divide-y divide-white/4">
              {section.items.map((item) => (
                <div
                  key={item.label}
                  className="p-6 flex items-center justify-between group cursor-pointer hover:bg-white/2 transition-colors"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 group-hover:text-accent transition-colors border border-white/8">
                      <item.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        {item.label}
                      </p>
                      <p className="font-bold text-brand-secondary">
                        {item.value}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-brand-secondary/20 group-hover:text-brand-secondary/60 transition-colors" />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="pt-4">
          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-between p-6 card-glass border-red-500/20 hover:bg-red-500/5 group transition-all"
          >
            <div className="flex items-center gap-5 text-red-400">
              <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20">
                <LogOut className="w-6 h-6" />
              </div>
              <span className="font-bold uppercase tracking-widest text-xs">
                Sign out of Sendzz
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-red-500/30 group-hover:text-red-500 transition-colors" />
          </button>
        </div>
      </div>
    </div>
  );
}
