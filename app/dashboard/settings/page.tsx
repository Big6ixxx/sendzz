'use client';

import { usePrivy } from '@privy-io/react-auth';
import { User, Shield, Bell, Globe, LogOut, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { user, logout } = usePrivy();

  const sections = [
    {
      title: 'Account',
      items: [
        { label: 'Email', value: user?.email?.address || 'Not set', icon: User },
        { label: 'Wallet', value: 'Smart Account Active', icon: Shield },
      ]
    },
    {
      title: 'Preferences',
      items: [
        { label: 'Notifications', value: 'Email only', icon: Bell },
        { label: 'Language', value: 'English (US)', icon: Globe },
      ]
    }
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-black uppercase tracking-tight">Settings</h1>
        <p className="text-muted-foreground font-medium">Manage your personal account and preferences.</p>
      </div>

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">{section.title}</h3>
            <div className="card-elegant p-0 overflow-hidden divide-y divide-border/50">
              {section.items.map((item) => (
                <div key={item.label} className="p-5 flex items-center justify-between group cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</p>
                      <p className="font-semibold">{item.value}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="pt-4">
          <button 
            onClick={() => logout()}
            className="w-full flex items-center justify-between p-5 card-elegant border-red-100 hover:bg-red-50 group transition-all"
          >
            <div className="flex items-center gap-4 text-red-600">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                <LogOut className="w-5 h-5" />
              </div>
              <span className="font-bold uppercase tracking-tight">Sign out of Sendzz</span>
            </div>
            <ChevronRight className="w-4 h-4 text-red-200 group-hover:text-red-400 transition-colors" />
          </button>
        </div>
      </div>
    </div>
  );
}
