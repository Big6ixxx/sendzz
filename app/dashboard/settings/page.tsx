'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { AddBankContactModal } from '@/components/deposit-withdraw/AddBankContactModal';
import { DeleteConfirmDialog } from '@/components/contacts/DeleteConfirmDialog';
import { getUserBankContacts, deleteBankContact, type BankContactRow } from '@/lib/supabase/bank-contacts';
import { getUserContacts, deleteContact, type ContactRow } from '@/lib/supabase/contacts';
import { AddContactModal } from '@/components/contacts/AddContactModal';
import { getInstitutions } from '@/lib/actions/ramp';
import { PaycrestInstitution } from '@/lib/paycrest/types';
import { usePrivy } from '@privy-io/react-auth';
import { AtSign, Bell, ChevronRight, Globe, Landmark, LogOut, Plus, Shield, Trash2, User, Eye, EyeOff, HelpCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useBalanceVisibility } from '@/components/providers/BalanceVisibilityProvider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { user, logout } = usePrivy();
  const router = useRouter();
  const userEmail = user?.email?.address || '';
  const { hideBalance, toggleBalanceVisibility } = useBalanceVisibility();

  const [bankContacts, setBankContacts] = useState<BankContactRow[]>([]);
  const [emailContacts, setEmailContacts] = useState<ContactRow[]>([]);
  const [institutions, setInstitutions] = useState<PaycrestInstitution[]>([]);
  const [addBankModalOpen, setAddBankModalOpen] = useState(false);
  const [addEmailModalOpen, setAddEmailModalOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string } | null>(null);
  const [emailContactToDelete, setEmailContactToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isBankLoading, setIsBankLoading] = useState(true);
  const [isEmailLoading, setIsEmailLoading] = useState(true);
  const [isSecurityLoading, setIsSecurityLoading] = useState(true);

  // Security Preferences
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState('500');
  const [isUpdatingSecurity, setIsUpdatingSecurity] = useState(false);

  const fetchBankContacts = useCallback(async () => {
    if (!userEmail) return;
    setIsBankLoading(true);
    const contacts = await getUserBankContacts(userEmail).catch(() => []);
    setBankContacts(contacts);
    setIsBankLoading(false);
  }, [userEmail]);

  const fetchEmailContacts = useCallback(async () => {
    if (!userEmail) return;
    setIsEmailLoading(true);
    const contacts = await getUserContacts(userEmail).catch(() => []);
    setEmailContacts(contacts);
    setIsEmailLoading(false);
  }, [userEmail]);

  const fetchSecurityPrefs = useCallback(async () => {
    if (!userEmail) return;
    setIsSecurityLoading(true);
    try {
      const res = await fetch(`/api/user/preferences?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setTwoFaEnabled(data.two_fa_enabled);
        setTwoFaThreshold(data.two_fa_threshold.toString());
      }
    } catch (err) {
      console.error('Failed to load security preferences', err);
    } finally {
      setIsSecurityLoading(false);
    }
  }, [userEmail]);

  const fetchContacts = useCallback(async () => {
    fetchBankContacts();
    fetchEmailContacts();
    fetchSecurityPrefs();
  }, [fetchBankContacts, fetchEmailContacts, fetchSecurityPrefs]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleOpenAddBankModal = async () => {
    if (institutions.length === 0) {
      const res = await getInstitutions('NGN').catch(() => ({ data: [] }));
      setInstitutions(res.data);
    }
    setAddBankModalOpen(true);
  };

  const handleDeleteBankConfirm = async () => {
    if (!contactToDelete) return;
    setIsDeleting(true);
    try {
      await deleteBankContact(userEmail, contactToDelete.id);
      toast.success('Account removed');
      fetchBankContacts();
    } catch {
      toast.error('Failed to remove account');
    } finally {
      setIsDeleting(false);
      setContactToDelete(null);
    }
  };

  const handleDeleteEmailConfirm = async () => {
    if (!emailContactToDelete) return;
    setIsDeleting(true);
    try {
      await deleteContact(userEmail, emailContactToDelete.id);
      toast.success('Contact removed');
      fetchEmailContacts();
    } catch {
      toast.error('Failed to remove contact');
    } finally {
      setIsDeleting(false);
      setEmailContactToDelete(null);
    }
  };

  const updateSecurityPrefs = async (enabled: boolean, threshold: string) => {
    if (!userEmail) return;
    setIsUpdatingSecurity(true);
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          two_fa_enabled: enabled,
          two_fa_threshold: parseFloat(threshold || '0'),
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      toast.success('Security preferences updated');
    } catch {
      toast.error('Failed to update security preferences');
      // revert on error
      fetchSecurityPrefs();
    } finally {
      setIsUpdatingSecurity(false);
    }
  };

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
        {
          label: 'Hide Sensitive Data',
          value: hideBalance ? 'On' : 'Off',
          icon: hideBalance ? EyeOff : Eye,
          onClick: toggleBalanceVisibility,
        },
      ],
    },
    {
      title: 'Help & Support',
      items: [
        {
          label: 'Fee Schedule & Gas',
          value: 'Learn about platform fees and gas sponsorship',
          icon: HelpCircle,
          onClick: () => router.push('/dashboard/settings/fees'),
        },
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
                  onClick={item.onClick}
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
                  {item.onClick ? (
                    <ChevronRight className="w-4 h-4 text-brand-secondary/20 group-hover:text-brand-secondary/60 transition-colors" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Security Section */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">
            Security
          </h3>
          <div className="card-glass p-0 overflow-hidden divide-y divide-white/4">
            {isSecurityLoading ? (
              <>
                <div className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-5 w-full">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl animate-pulse" />
                    <div className="space-y-2 flex-1">
                      <div className="h-3 w-32 bg-white/10 rounded animate-pulse" />
                      <div className="h-4 w-48 bg-white/10 rounded animate-pulse" />
                    </div>
                  </div>
                </div>
                <div className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-5 w-full">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl animate-pulse" />
                    <div className="space-y-2 flex-1">
                      <div className="h-3 w-32 bg-white/10 rounded animate-pulse" />
                      <div className="h-4 w-48 bg-white/10 rounded animate-pulse" />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="p-6 flex items-center justify-between hover:bg-white/2 transition-colors">
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 border border-white/8">
                      <Shield className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        Two-Factor Authentication
                      </p>
                      <p className="font-bold text-brand-secondary">
                        Require OTP for large transactions
                      </p>
                    </div>
                  </div>
                  <Switch 
                    checked={twoFaEnabled} 
                    onCheckedChange={(checked: boolean) => {
                      setTwoFaEnabled(checked);
                      updateSecurityPrefs(checked, twoFaThreshold);
                    }} 
                    disabled={isUpdatingSecurity}
                  />
                </div>
                
                <div className="p-6 flex items-center justify-between hover:bg-white/2 transition-colors">
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 border border-white/8">
                      <Landmark className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        2FA Threshold (USDC)
                      </p>
                      <p className="font-bold text-brand-secondary text-sm max-w-xs">
                        Transactions above this amount will require an email OTP verification.
                      </p>
                    </div>
                  </div>
                  <div className="w-32">
                    <Input
                      type="number"
                      value={twoFaThreshold}
                      onChange={(e) => setTwoFaThreshold(e.target.value)}
                      onBlur={() => updateSecurityPrefs(twoFaEnabled, twoFaThreshold)}
                      disabled={!twoFaEnabled || isUpdatingSecurity}
                      placeholder="500"
                      className="bg-white/5 border-white/10 text-right"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Email Recipients */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Saved Recipients
            </h3>
            <button
              onClick={() => setAddEmailModalOpen(true)}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Recipient
            </button>
          </div>
          <div className="card-glass p-0 overflow-hidden">
            {isEmailLoading ? (
              <div className="divide-y divide-white/4">
                {[1, 2].map((i) => (
                  <div key={i} className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0 w-full">
                      <div className="w-10 h-10 bg-white/5 rounded-2xl shrink-0 animate-pulse" />
                      <div className="space-y-2 flex-1">
                        <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
                        <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : emailContacts.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mx-auto border border-white/8">
                  <AtSign className="w-6 h-6 text-brand-secondary/20" />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-brand-secondary/30">
                  No saved recipients
                </p>
                <button
                  onClick={() => setAddEmailModalOpen(true)}
                  className="text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
                >
                  + Add your first recipient
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/4">
                {emailContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="p-5 flex items-center justify-between hover:bg-white/2 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 bg-accent/10 rounded-2xl flex items-center justify-center shrink-0 border border-accent/10">
                        <AtSign className="w-5 h-5 text-accent" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-brand-secondary truncate">
                          {contact.name}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30 truncate">
                          {contact.email}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setEmailContactToDelete({ id: contact.id, name: contact.name })}
                      className="p-2 text-brand-secondary/20 hover:text-red-400 transition-colors rounded-xl hover:bg-red-400/10 ml-4 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bank Contacts */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Saved Bank Accounts
            </h3>
            <button
              onClick={handleOpenAddBankModal}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Account
            </button>
          </div>
          <div className="card-glass p-0 overflow-hidden">
            {isBankLoading ? (
              <div className="divide-y divide-white/4">
                {[1, 2].map((i) => (
                  <div key={i} className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0 w-full">
                      <div className="w-10 h-10 bg-white/5 rounded-2xl shrink-0 animate-pulse" />
                      <div className="space-y-2 flex-1">
                        <div className="h-4 w-40 bg-white/10 rounded animate-pulse" />
                        <div className="h-3 w-32 bg-white/10 rounded animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : bankContacts.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mx-auto border border-white/8">
                  <Landmark className="w-6 h-6 text-brand-secondary/20" />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-brand-secondary/30">
                  No saved bank accounts
                </p>
                <button
                  onClick={handleOpenAddBankModal}
                  className="text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
                >
                  + Add your first account
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/4">
                {bankContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="p-5 flex items-center justify-between hover:bg-white/2 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 bg-accent/10 rounded-2xl flex items-center justify-center shrink-0 border border-accent/10">
                        <Landmark className="w-5 h-5 text-accent" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-brand-secondary truncate">
                          {contact.account_name}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30 truncate">
                          {contact.bank_name} • {contact.account_number}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setContactToDelete({ id: contact.id, name: contact.account_name })}
                      className="p-2 text-brand-secondary/20 hover:text-red-400 transition-colors rounded-xl hover:bg-red-400/10 ml-4 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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

      <AddContactModal
        isOpen={addEmailModalOpen}
        onClose={() => setAddEmailModalOpen(false)}
        senderEmail={userEmail}
        onSuccess={fetchContacts}
      />

      <AddBankContactModal
        isOpen={addBankModalOpen}
        onClose={() => setAddBankModalOpen(false)}
        userEmail={userEmail}
        defaultAccountNumber=""
        institutions={institutions}
        onSuccess={fetchContacts}
      />

      <DeleteConfirmDialog
        contactToDelete={contactToDelete}
        isPending={isDeleting}
        onConfirm={handleDeleteBankConfirm}
        onCancel={() => setContactToDelete(null)}
      />

      <DeleteConfirmDialog
        contactToDelete={emailContactToDelete}
        isPending={isDeleting}
        onConfirm={handleDeleteEmailConfirm}
        onCancel={() => setEmailContactToDelete(null)}
      />
    </div>
  );
}
