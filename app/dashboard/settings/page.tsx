"use client";

import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { AddBankContactModal } from "@/components/deposit-withdraw/AddBankContactModal";
import { DeleteConfirmDialog } from "@/components/contacts/DeleteConfirmDialog";
import {
  getUserBankContacts,
  deleteBankContact,
  type BankContactRow,
} from "@/lib/supabase/bank-contacts";
import {
  getUserContacts,
  deleteContact,
  type ContactRow,
} from "@/lib/supabase/contacts";
import { AddContactModal } from "@/components/contacts/AddContactModal";
import { getInstitutions } from "@/lib/actions/ramp";
import { RampInstitution } from "@/lib/ramp";
import { CHAIN_NAMES } from "@/lib/circle/gateway";
import { usePrivy } from "@privy-io/react-auth";
import {
  AtSign,
  Bell,
  ChevronRight,
  Globe,
  Landmark,
  LogOut,
  Plus,
  Shield,
  Trash2,
  User,
  Eye,
  EyeOff,
  HelpCircle,
  Smartphone,
  Network,
  KeyRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { TOTPSetupWizard } from "@/components/TOTPSetupWizard";
import { PasskeySetupWizard } from "@/components/PasskeySetupWizard";
import {
  PinGate,
  PinInput,
  type PinGateRequest,
} from "@/components/security/PinGate";
import { Fingerprint } from "lucide-react";
import { KycModal } from "@/components/kyc/KycModal";
import { InstallAppButton } from "@/components/pwa/InstallAppButton";
import { LimitsMeter, type Allowance } from "@/components/kyc/LimitsMeter";

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  activeColor: string;
  activeBg: string;
}

function PremiumToggle({ checked, onChange, disabled, activeColor, activeBg }: ToggleProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      disabled={disabled}
      className={`relative inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border transition-all duration-300 ease-in-out focus:outline-none ${
        checked 
          ? `${activeBg} shadow-inner` 
          : 'bg-white/5 border-white/10 hover:border-white/20'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none absolute top-[2px] left-[2px] block h-5 w-5 rounded-full transition-all duration-300 ease-in-out ${
          checked 
            ? `${activeColor} translate-x-[20px] shadow-[0_0_8px_rgba(255,255,255,0.2)]` 
            : 'bg-white/30 translate-x-0'
        }`}
      />
    </button>
  );
}

const NON_EVM_RAILS = ["Solana", "Stellar"] as const;

export default function SettingsPage() {
  const { user, logout } = usePrivy();
  const router = useRouter();
  const userEmail = user?.email?.address || "";
  const { hideBalance, toggleBalanceVisibility } = useBalanceVisibility();

  const [bankContacts, setBankContacts] = useState<BankContactRow[]>([]);
  const [emailContacts, setEmailContacts] = useState<ContactRow[]>([]);
  const [institutions, setInstitutions] = useState<RampInstitution[]>([]);
  const [addBankModalOpen, setAddBankModalOpen] = useState(false);
  const [addEmailModalOpen, setAddEmailModalOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [emailContactToDelete, setEmailContactToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isBankLoading, setIsBankLoading] = useState(true);
  const [isEmailLoading, setIsEmailLoading] = useState(true);
  const [isSecurityLoading, setIsSecurityLoading] = useState(true);

  // Security Preferences
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState("500");
  const [isUpdatingSecurity, setIsUpdatingSecurity] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetupOpen, setTotpSetupOpen] = useState(false);
  const [thresholdModalOpen, setThresholdModalOpen] = useState(false);
  const [thresholdValue, setThresholdValue] = useState("500");
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [passkeySetupOpen, setPasskeySetupOpen] = useState(false);
  // PIN is tracked separately from the passkey so each can be added or removed on its own.
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [pinRemoveOpen, setPinRemoveOpen] = useState(false);
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinGate, setPinGate] = useState<PinGateRequest | null>(null);

  // Notification Preferences
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  // Email Notification Preferences
  const [emailPrefs, setEmailPrefs] = useState({
    email_notif_transfer:   true,
    email_notif_deposit:    true,
    email_notif_withdrawal: true,
    email_notif_bridge:     true,
    email_notif_security:   true,
  });
  const [isSavingEmailPrefs, setIsSavingEmailPrefs] = useState(false);

  const fetchBankContacts = useCallback(async () => {
    if (!userEmail) return;
    setIsBankLoading(true);
    const contacts = await getUserBankContacts().catch(() => []);
    setBankContacts(contacts);
    setIsBankLoading(false);
  }, [userEmail]);

  // ─── KYC State ────────────────────────────────────────────────────────────
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [kycData, setKycData] = useState<{
    kyc: { status: string; updatedAt: string };
    totals: { daily: number; weekly: number; monthly: number };
    allowance: Allowance | null;
  } | null>(null);
  const [isKycLoading, setIsKycLoading] = useState(true);

  const fetchKycStatus = useCallback(async () => {
    if (!userEmail) return;
    setIsKycLoading(true);
    try {
      const res = await fetch(`/api/kyc/status?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) setKycData(await res.json());
    } catch {
      // non-critical
    } finally {
      setIsKycLoading(false);
    }
  }, [userEmail]);

  useEffect(() => { fetchKycStatus(); }, [fetchKycStatus]);
  // Whether a PIN exists. Only ever a boolean — the hash never leaves the server.
  useEffect(() => { void fetchPinStatus(); }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Fetch email notification preferences once the user email is known
  useEffect(() => {
    if (!userEmail) return;
    fetch(`/api/notifications/email-prefs?email=${encodeURIComponent(userEmail)}`)
      .then((r) => r.json())
      .then((data) => { if (data.prefs) setEmailPrefs(data.prefs); })
      .catch(() => {});
  }, [userEmail]);

  const handleEmailPrefToggle = async (key: keyof typeof emailPrefs) => {
    if (isSavingEmailPrefs) return;
    const next = { ...emailPrefs, [key]: !emailPrefs[key] };
    setEmailPrefs(next);
    setIsSavingEmailPrefs(true);
    try {
      await fetch('/api/notifications/email-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, prefs: { [key]: next[key] } }),
      });
    } catch {
      setEmailPrefs(emailPrefs); // revert on failure
      toast.error('Failed to save notification preference.');
    } finally {
      setIsSavingEmailPrefs(false);
    }
  };

  const fetchEmailContacts = useCallback(async () => {
    if (!userEmail) return;
    setIsEmailLoading(true);
    const contacts = await getUserContacts().catch(() => []);
    setEmailContacts(contacts);
    setIsEmailLoading(false);
  }, [userEmail]);

  const fetchSecurityPrefs = useCallback(async () => {
    if (!userEmail) return;
    setIsSecurityLoading(true);
    try {
      const res = await fetch(
        `/api/user/preferences?email=${encodeURIComponent(userEmail)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setTwoFaEnabled(data.two_fa_enabled);
        setTwoFaThreshold(data.two_fa_threshold.toString());
        setTotpEnabled(data.totp_enabled || false);
        const credentials = data.webauthn_credentials || [];
        setPasskeyEnabled(Array.isArray(credentials) && credentials.length > 0);
      }
    } catch (err) {
      console.error("Failed to load security preferences", err);
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
      const res = await getInstitutions().catch(() => ({ data: [] }));
      setInstitutions(res.data);
    }
    setAddBankModalOpen(true);
  };

  const handleDeleteBankConfirm = async () => {
    if (!contactToDelete) return;
    setIsDeleting(true);
    try {
      await deleteBankContact(contactToDelete.id);
      toast.success("Account removed");
      fetchBankContacts();
    } catch {
      toast.error("Failed to remove account");
    } finally {
      setIsDeleting(false);
      setContactToDelete(null);
    }
  };

  const handleDeleteEmailConfirm = async () => {
    if (!emailContactToDelete) return;
    setIsDeleting(true);
    try {
      await deleteContact(emailContactToDelete.id);
      toast.success("Contact removed");
      fetchEmailContacts();
    } catch {
      toast.error("Failed to remove contact");
    } finally {
      setIsDeleting(false);
      setEmailContactToDelete(null);
    }
  };

  const updateSecurityPrefs = async (
    enabled: boolean,
    threshold: string,
  ): Promise<boolean> => {
    if (!userEmail) return false;
    setIsUpdatingSecurity(true);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          two_fa_enabled: enabled,
          two_fa_threshold: parseFloat(threshold || "0"),
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Security preferences updated");
      return true;
    } catch {
      toast.error("Failed to update security preferences");
      // revert on error
      fetchSecurityPrefs();
      return false;
    } finally {
      setIsUpdatingSecurity(false);
    }
  };

  const handleDisableTotp = async () => {
    if (!userEmail) return;
    setIsUpdatingSecurity(true);
    try {
      const res = await fetch("/api/2fa/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });
      if (!res.ok) throw new Error("Failed to disable");
      toast.success("Authenticator app disabled");
      setTotpEnabled(false);
      // Security alert notification
      fetch("/api/notifications/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, event: "totp_disabled" }),
      }).catch(() => {});
    } catch {
      toast.error("Failed to disable authenticator app");
    } finally {
      setIsUpdatingSecurity(false);
    }
  };

  /** Saving a threshold is the same write as the toggle, with the same revert on failure. */
  const handleThresholdUpdate = async () => {
    const previous = twoFaThreshold;
    setTwoFaThreshold(thresholdValue);
    setThresholdModalOpen(false);
    const ok = await updateSecurityPrefs(twoFaEnabled, thresholdValue);
    if (!ok) setTwoFaThreshold(previous);
  };

  /**
   * Run `req.run()` only after the PIN is confirmed.
   *
   * The PIN is the key every other security control is locked behind, so it has to exist
   * before there is anything to lock: without one, this sends the user to set it rather than
   * letting them add a factor that nothing can protect.
   */
  const withPin = (req: PinGateRequest) => () => {
    if (!pinEnabled) {
      toast.error("Set your transaction PIN first — it protects every other change.");
      setPinSetupOpen(true);
      return;
    }
    setPinGate(req);
  };

  /** Re-read every security method at once, so one setup flow cannot leave another stale. */
  const refreshSecurityStatus = () => {
    fetchSecurityPrefs();
    void fetchPinStatus();
  };

  const fetchPinStatus = async () => {
    try {
      const res = await fetch("/api/2fa/pin");
      const data = await res.json();
      setPinEnabled(!!data?.enabled);
    } catch {
      setPinEnabled(false);
    }
  };

  const handleRemovePin = async () => {
    setIsUpdatingSecurity(true);
    setPinError(null);
    try {
      const res = await fetch("/api/2fa/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", currentPin: pinConfirm }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinError(data.error ?? "Could not remove your PIN.");
        return;
      }
      setPinEnabled(false);
      setPinRemoveOpen(false);
      setPinConfirm("");
      toast.success("PIN removed.");
    } catch {
      setPinError("Could not reach the server. Try again.");
    } finally {
      setIsUpdatingSecurity(false);
    }
  };

  const handleDisablePasskey = async () => {
    if (!userEmail) return;
    setIsUpdatingSecurity(true);
    try {
      const res = await fetch("/api/2fa/passkey/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });
      if (!res.ok) throw new Error("Failed to disable passkey");
      setPasskeyEnabled(false);
      toast.success("Passkey disabled successfully");
      fetchSecurityPrefs();
      // Security alert notification
      fetch("/api/notifications/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, event: "passkey_disabled" }),
      }).catch(() => {});
    } catch {
      toast.error("Failed to disable passkey. Please try again.");
    } finally {
      setIsUpdatingSecurity(false);
    }
  };

  const handleTogglePush = async () => {
    if (isTogglingPush) return;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      toast.error("Push notifications are not supported in this browser.");
      return;
    }
    setIsTogglingPush(true);
    try {
      if (!pushEnabled) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast.error("Notification permission was denied.");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) return;
        const padding = '='.repeat((4 - vapidKey.length % 4) % 4);
        const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const key = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) key[i] = rawData.charCodeAt(i);
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, subscription }),
        });
        setPushEnabled(true);
        toast.success("Push notifications enabled!");
      } else {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
        setPushEnabled(false);
        toast.success("Push notifications disabled.");
      }
    } catch {
      toast.error("Failed to update notification settings.");
    } finally {
      setIsTogglingPush(false);
    }
  };

  void handleEmailPrefToggle;
  void handleTogglePush;

  interface SettingItem {
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick?: () => void;
    action?: React.ReactNode;
  }

  interface SettingSection {
    title: string;
    items: SettingItem[];
  }

  const sections: SettingSection[] = [
    {
      title: "Account",
      items: [
        {
          label: "Email",
          value: user?.email?.address || "Not set",
          icon: User,
        },
        { label: "Wallet", value: "Smart Account Active", icon: Shield },
        {
          label: "Networks",
          // EVM chains share one smart-account address; Solana and Stellar are each a
          // separate rail with their own address. Counted from the same list the rest of
          // the app routes on, plus the two non-EVM rails named explicitly — the count was
          // hardcoded as "+ 1" and silently stopped including Stellar when it was added.
          value: `Active on ${Object.keys(CHAIN_NAMES).length + NON_EVM_RAILS.length} networks (EVM + ${NON_EVM_RAILS.join(" + ")})`,
          icon: Network,
        },
      ],
    },
    {
      title: "Preferences",
      items: [
        {
          label: "Notifications",
          value: "Manage push & email notification preferences",
          icon: Bell,
          onClick: () => router.push("/dashboard/settings/notifications"),
        },
        {
          // Always offered while the app is not installed. The browser's own banner appears
          // once, unbidden, and never returns once dismissed — so this is the only place a
          // user who said "not now" can come back to.
          label: "Install Sendzz",
          value: "Add it to your home screen and open it like an app",
          icon: Smartphone,
          action: <InstallAppButton compact />,
        },
        { label: "Language", value: "English (US)", icon: Globe },
        {
          label: "Hide Sensitive Data",
          value: hideBalance ? "On" : "Off",
          icon: hideBalance ? EyeOff : Eye,
          onClick: toggleBalanceVisibility,
        },
      ],
    },
    {
      title: "Help & Support",
      items: [
        {
          label: "Help Center & FAQ",
          value: "Fees, gas sponsorship, KYC limits, and common questions",
          icon: HelpCircle,
          onClick: () => router.push("/dashboard/settings/fees"),
        },
      ],
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
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
                  onClick={item.action ? undefined : item.onClick}
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
                  {item.action ? (
                    <div onClick={(e) => e.stopPropagation()}>{item.action}</div>
                  ) : item.onClick ? (
                    <ChevronRight className="w-4 h-4 text-brand-secondary/20 group-hover:text-brand-secondary/60 transition-colors" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ── Identity Verification Section ─────────────────────────────────── */}
        {/* Anchored: the limit modal links straight here rather than to the top of the page. */}
        <div id="identity" className="space-y-4 scroll-mt-24">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">
            Identity Verification
          </h3>
          <div className="card-glass p-6 space-y-6">
            {isKycLoading ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-4 w-48 bg-white/10 rounded" />
                <div className="h-2 w-full bg-white/10 rounded" />
                <div className="h-2 w-full bg-white/10 rounded" />
                <div className="h-2 w-full bg-white/10 rounded" />
              </div>
            ) : (
              <>
                {/* Status badge + CTA */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{
                        background:
                          kycData?.kyc.status === "approved"
                            ? "rgba(0,232,122,0.12)"
                            : kycData?.kyc.status === "declined"
                            ? "rgba(239,68,68,0.12)"
                            : kycData?.kyc.status === "pending" || kycData?.kyc.status === "in_review"
                            ? "rgba(59,130,246,0.12)"
                            : "rgba(255,255,255,0.05)",
                      }}
                    >
                      <Shield
                        className="w-5 h-5"
                        style={{
                          color:
                            kycData?.kyc.status === "approved"
                              ? "#00e87a"
                              : kycData?.kyc.status === "declined"
                              ? "#ef4444"
                              : kycData?.kyc.status === "pending" || kycData?.kyc.status === "in_review"
                              ? "#60a5fa"
                              : "rgba(248,248,246,0.3)",
                        }}
                      />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(248,248,246,0.3)" }}>
                        KYC Status
                      </p>
                      <p className="font-bold text-sm" style={{ color: "rgba(248,248,246,0.85)" }}>
                        {kycData?.kyc.status === "approved"
                          ? "✓ Verified"
                          : kycData?.kyc.status === "declined"
                          ? "✗ Not Approved"
                          : kycData?.kyc.status === "pending"
                          ? "⏳ In Progress"
                          : kycData?.kyc.status === "in_review"
                          ? "🔍 Under Review"
                          : "Not Started"}
                      </p>
                    </div>
                  </div>

                  {kycData?.kyc.status !== "approved" && kycData?.kyc.status !== "in_review" && (
                    <button
                      id="settings-kyc-verify-btn"
                      onClick={() => setKycModalOpen(true)}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                      style={{
                        background: "linear-gradient(135deg, rgba(0,232,122,0.15) 0%, rgba(0,196,104,0.08) 100%)",
                        color: "#00e87a",
                        border: "1px solid rgba(0,232,122,0.25)",
                      }}
                    >
                      {kycData?.kyc.status === "declined" ? "Try Again" : "Verify Identity"}
                    </button>
                  )}
                </div>

                {/* Limits meter */}
                {kycData && (
                  <LimitsMeter
                    totals={kycData.totals}
                    allowance={kycData.allowance}
                    isVerified={kycData.kyc.status === "approved"}
                  />
                )}

                {kycData?.kyc.status !== "approved" && (
                  <p className="text-xs" style={{ color: "rgba(248,248,246,0.3)" }}>
                    Verifying is a one-time check that takes a few minutes. It removes the
                    withdrawal allowance entirely, and it is what the regulations we operate
                    under require of us.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

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
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-black tracking-wider ${twoFaEnabled ? 'text-accent' : 'text-white/35'}`}>
                      {twoFaEnabled ? 'ON' : 'OFF'}
                    </span>
                    <PremiumToggle
                      checked={twoFaEnabled}
                      onChange={withPin({
                        title: twoFaEnabled
                          ? "Turn off verification"
                          : "Turn on verification",
                        description: twoFaEnabled
                          ? "Large withdrawals will stop asking for a second check. Confirm with your PIN."
                          : "Large withdrawals will ask for a second check. Confirm with your PIN.",
                        confirmLabel: twoFaEnabled ? "Turn off" : "Turn on",
                        destructive: twoFaEnabled,
                        run: () => {
                          const checked = !twoFaEnabled;
                          setTwoFaEnabled(checked);
                          updateSecurityPrefs(checked, twoFaThreshold);
                        },
                      })}
                      disabled={isUpdatingSecurity}
                      activeColor="bg-[#00e87a]"
                      activeBg="bg-[#00e87a]/15 border-[#00e87a]/40"
                    />
                  </div>
                </div>

                <div
                  className="p-6 flex items-center justify-between hover:bg-white/2 transition-colors cursor-pointer"
                  onClick={() => {
                    if (!twoFaEnabled) return;
                    withPin({
                      title: "Change verification threshold",
                      description:
                        "Raising the threshold means more can be withdrawn without a second check. Confirm with your PIN.",
                      confirmLabel: "Continue",
                      run: () => {
                        setThresholdValue(twoFaThreshold);
                        setThresholdModalOpen(true);
                      },
                    })();
                  }}
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 border border-white/8">
                      <Landmark className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        2FA Threshold (USDC)
                      </p>
                      <p className="font-bold text-brand-secondary text-sm max-w-xs">
                        Transactions above this amount will require an email OTP
                        verification.
                      </p>
                    </div>
                  </div>
                  <div
                    className={`px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-right font-bold text-brand-secondary transition-colors ${
                      !twoFaEnabled ? "opacity-50" : ""
                    }`}
                  >
                    ${twoFaThreshold}
                  </div>
                </div>

                <div className="p-6 flex items-center justify-between hover:bg-white/2 transition-colors">
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 border border-white/8">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        Authenticator App
                      </p>
                      <p className="font-bold text-brand-secondary">
                        {totpEnabled ? "Enabled" : "Not set up"}
                      </p>
                    </div>
                  </div>
                  {totpEnabled ? (
                    <button
                      onClick={withPin({
                        title: "Remove authenticator app",
                        description:
                          "Codes from your authenticator app will no longer be accepted. You can pair an app again at any time.",
                        confirmLabel: "Remove app",
                        destructive: true,
                        run: handleDisableTotp,
                      })}
                      className="text-xs font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={withPin({
                        title: "Add authenticator app",
                        description:
                          "Confirm it is you before adding a new way to approve withdrawals.",
                        confirmLabel: "Continue",
                        run: () => setTotpSetupOpen(true),
                      })}
                      className="text-xs font-bold uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
                    >
                      Set up
                    </button>
                  )}
                </div>

                <div className="p-6 flex items-center justify-between hover:bg-white/2 transition-colors">
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 border border-white/8">
                      <Fingerprint className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        Passkey
                      </p>
                      <p className="font-bold text-brand-secondary">
                        {passkeyEnabled ? "Enabled" : "Not set up"}
                      </p>
                    </div>
                  </div>
                  {passkeyEnabled ? (
                    <button
                      onClick={withPin({
                        title: "Remove passkey",
                        description:
                          "Every passkey on your account is removed. Withdrawals will fall back to your other methods.",
                        confirmLabel: "Remove passkey",
                        destructive: true,
                        run: handleDisablePasskey,
                      })}
                      className="text-xs font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={withPin({
                        title: "Add passkey",
                        description:
                          "Confirm it is you before adding a new way to approve withdrawals.",
                        confirmLabel: "Continue",
                        run: () => setPasskeySetupOpen(true),
                      })}
                      className="text-xs font-bold uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
                    >
                      Set up
                    </button>
                  )}
                </div>

                {/* Its own row, so a PIN can be added or removed without touching the
                    passkey. Anything less means turning one off to reach the other. */}
                <div className="p-6 flex items-center justify-between hover:bg-white/2 transition-colors">
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-brand-secondary/40 border border-white/8">
                      <KeyRound className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                        Transaction PIN
                      </p>
                      <p className="font-bold text-brand-secondary">
                        {pinEnabled ? "Enabled" : "Not set up"}
                      </p>
                    </div>
                  </div>
                  {pinEnabled ? (
                    <button
                      onClick={() => setPinRemoveOpen(true)}
                      className="text-xs font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => setPinSetupOpen(true)}
                      className="text-xs font-bold uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
                    >
                      Set up
                    </button>
                  )}
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
                  <div
                    key={i}
                    className="p-5 flex items-center justify-between"
                  >
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
                      onClick={() =>
                        setEmailContactToDelete({
                          id: contact.id,
                          name: contact.name,
                        })
                      }
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
                  <div
                    key={i}
                    className="p-5 flex items-center justify-between"
                  >
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
                      onClick={() =>
                        setContactToDelete({
                          id: contact.id,
                          name: contact.account_name,
                        })
                      }
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

      <TOTPSetupWizard
        open={totpSetupOpen}
        onOpenChange={setTotpSetupOpen}
        email={userEmail}
        onComplete={() => {
          fetchSecurityPrefs();
          toast.success("Authenticator app enabled");
          fetch("/api/notifications/security", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, event: "totp_enabled" }),
          }).catch(() => {});
        }}
      />

      {/* Threshold Modal */}
      <Dialog open={thresholdModalOpen} onOpenChange={setThresholdModalOpen}>
        <DialogContent className="card-glass border-white/10 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl text-brand-secondary">
              Verification threshold
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-brand-secondary/70 leading-relaxed">
              Withdrawals above this amount ask for a second check. Anything below
              goes straight through, so a lower figure is the safer one.
            </p>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                Amount in USDC
              </label>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-secondary/35 pointer-events-none">
                  $
                </span>
                <input
                  type="number"
                  value={thresholdValue}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val > 500) setThresholdValue("500");
                    else if (val < 0) setThresholdValue("0");
                    else setThresholdValue(e.target.value);
                  }}
                  max={500}
                  min={0}
                  className="input-elegant w-full pl-10 text-lg font-bold tabular-nums"
                  placeholder="500"
                />
              </div>
              <p className="text-[12px] text-brand-secondary/40">
                The most you can set is $500.
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
            <button
              onClick={() => setThresholdModalOpen(false)}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              onClick={handleThresholdUpdate}
              disabled={isUpdatingSecurity}
              className="btn-primary flex-1"
            >
              {isUpdatingSecurity ? "Saving..." : "Save threshold"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* One dialog for every security change that needs the PIN. */}
      <PinGate request={pinGate} onClose={() => setPinGate(null)} />

      {/*
        Both mounts refresh BOTH methods. The wizard offers to add the other once one is set,
        so a PIN can be created from the passkey flow and vice versa — refreshing only the one
        the row is named after would leave the other showing "Not set up" until a reload, and
        the user would set it a second time.
      */}
      <PasskeySetupWizard
        open={passkeySetupOpen}
        onOpenChange={setPasskeySetupOpen}
        email={userEmail}
        onComplete={refreshSecurityStatus}
      />

      {/* Same wizard, opened straight on the PIN step from its own row. */}
      <PasskeySetupWizard
        open={pinSetupOpen}
        onOpenChange={setPinSetupOpen}
        email={userEmail}
        initialMethod="pin"
        onComplete={refreshSecurityStatus}
      />

      {/* PIN Remove Modal */}
      <Dialog
        open={pinRemoveOpen}
        onOpenChange={(v) => {
          setPinRemoveOpen(v);
          if (!v) {
            setPinConfirm("");
            setPinError(null);
          }
        }}
      >
        <DialogContent className="card-glass border-white/10 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl text-brand-secondary">
              Remove PIN
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-brand-secondary/70 leading-relaxed">
              Withdrawals above your threshold will fall back to your other
              methods. You can set a new PIN at any time.
            </p>

            {/* Proving you know the current PIN is what stops anyone who reaches an
                open session from quietly stripping the factor that protects it. */}
            <PinInput
              label="Current PIN"
              value={pinConfirm}
              onChange={(v) => {
                setPinError(null);
                setPinConfirm(v);
              }}
              onEnter={handleRemovePin}
              error={pinError}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
            <button
              onClick={() => setPinRemoveOpen(false)}
              className="btn-secondary flex-1"
            >
              Keep it
            </button>
            <button
              onClick={handleRemovePin}
              disabled={isUpdatingSecurity || pinConfirm.length < 4}
              className="btn-primary flex-1 !bg-red-500 !text-white hover:!bg-red-600"
            >
              {isUpdatingSecurity ? "Removing..." : "Remove PIN"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* KYC Verification Modal */}
      <KycModal
        isOpen={kycModalOpen}
        onClose={() => {
          setKycModalOpen(false);
          // Re-fetch status after modal closes
          setTimeout(fetchKycStatus, 1000);
        }}
        userEmail={userEmail}
      />
    </div>
  );
}

