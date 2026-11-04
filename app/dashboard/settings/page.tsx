"use client";

import { DocBody, DocHeader, DocReadNext, DocSection } from "@/components/dashboard/DocLayout";
import { DocRows, RowAction, SettingsRow, Switch } from "@/components/dashboard/SettingsKit";
import { shortenDetail } from "@/components/dashboard/activity-look";
import { AmountField, CurrencyPill, FlowButton, FlowDialog } from "@/components/flow/ui";
import { cn } from "@/lib/utils";
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
import { LogOut, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import { TOTPSetupWizard } from "@/components/TOTPSetupWizard";
import { PasskeySetupWizard } from "@/components/PasskeySetupWizard";
import {
  SecurityStepUp,
  type StepUpRequest,
} from "@/components/security/SecurityStepUp";
import { ForgotPinDialog } from "@/components/security/ForgotPinDialog";
import { KycModal } from "@/components/kyc/KycModal";
import { InstallAppButton } from "@/components/pwa/InstallAppButton";
import { LimitsMeter, type Allowance } from "@/components/kyc/LimitsMeter";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/lib/theme";

const NON_EVM_RAILS = ["Solana", "Stellar"] as const;

export default function SettingsPage() {
  const { user, logout } = usePrivy();
  const userEmail = user?.email?.address || "";
  const { hideBalance, toggleBalanceVisibility } = useBalanceVisibility();
  const [theme, setTheme] = useTheme();

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
  const [forgotPinOpen, setForgotPinOpen] = useState(false);
  // The threshold is confirmed with the PIN and then typed into a second dialog, so the token
  // minted at confirmation has to survive until the value is actually submitted.
  const [thresholdAuthorization, setThresholdAuthorization] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null);

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
        "/api/user/preferences",
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
    authorization: string,
  ): Promise<boolean> => {
    if (!userEmail) return false;
    setIsUpdatingSecurity(true);
    try {
      // No email in the body — the server takes it from the session. The authorization is a
      // single-use token minted when the PIN was accepted, which the server requires before
      // it will weaken anything.
      const res = await fetch("/api/user/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          two_fa_enabled: enabled,
          two_fa_threshold: parseFloat(threshold || "0"),
          authorization,
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

  const handleDisableTotp = async (authorization: string) => {
    if (!userEmail) return;
    setIsUpdatingSecurity(true);
    try {
      const res = await fetch("/api/2fa/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization }),
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
    // Spent here rather than at confirmation: the token is bound to the threshold control and
    // single-use, so a dialog opened and abandoned simply expires unspent.
    const authorization = thresholdAuthorization;
    if (!authorization) {
      toast.error("That took too long. Confirm with your PIN again.");
      setThresholdModalOpen(false);
      return;
    }

    const previous = twoFaThreshold;
    setTwoFaThreshold(thresholdValue);
    setThresholdModalOpen(false);
    setThresholdAuthorization(null);
    const ok = await updateSecurityPrefs(twoFaEnabled, thresholdValue, authorization);
    if (!ok) setTwoFaThreshold(previous);
  };

  /**
   * Run `req.run()` only after a SECOND FACTOR is proven — not the PIN.
   *
   * The PIN authorises every outgoing payment. If it also switched protections off, one secret
   * would open both doors: somebody who read it over a shoulder would get the money and the
   * ability to disable everything that would have stopped them. So weakening a protection
   * costs one of the protections — the authenticator app, a passkey, or a code emailed to the
   * address on the account.
   *
   * Email is always available, so this can never lock somebody out of their own settings.
   */
  const withStepUp = (req: Omit<StepUpRequest, "totpEnabled" | "passkeyEnabled">) => () => {
    setStepUp({ ...req, totpEnabled, passkeyEnabled });
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


  const handleDisablePasskey = async (authorization: string) => {
    if (!userEmail) return;
    setIsUpdatingSecurity(true);
    try {
      const res = await fetch("/api/2fa/passkey/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization }),
      });
      if (!res.ok) throw new Error("Failed to disable passkey");
      setPasskeyEnabled(false);
      toast.success("Passkey disabled successfully");
      fetchSecurityPrefs();
      // Security alert notification
      fetch("/api/notifications/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "passkey_disabled" }),
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

  const kycStatus = kycData?.kyc.status;
  const verified = kycStatus === "approved";
  const kycLabel =
    kycStatus === "approved"
      ? "Verified"
      : kycStatus === "declined"
        ? "Not approved"
        : kycStatus === "pending"
          ? "In progress"
          : kycStatus === "in_review"
            ? "Under review"
            : "Not verified";
  const networkCount = Object.keys(CHAIN_NAMES).length + NON_EVM_RAILS.length;

  // The protections the account can have, as the meter on the account card counts them.
  const protections = [
    { label: "PIN", on: pinEnabled },
    { label: "Large withdrawal check", on: twoFaEnabled },
    { label: "Authenticator app", on: totpEnabled },
    { label: "Passkey", on: passkeyEnabled },
  ];
  const protectionsOn = protections.filter((p) => p.on).length;

  const nav = [
    { id: "account", label: "Your account" },
    { id: "verification", label: "Verification" },
    { id: "security", label: "Security" },
    { id: "recipients", label: "Saved recipients" },
    { id: "banks", label: "Bank accounts" },
    { id: "preferences", label: "Preferences" },
    { id: "sign-out", label: "Signing out" },
  ];

  const addButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--lp-ink)] px-4 text-[14px] font-semibold text-[var(--lp-cream)]"
    >
      <Plus className="size-4" /> {label}
    </button>
  );
  const skeletonRows = (n: number) =>
    Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex items-center gap-3 py-4">
        <Skeleton tone="page" className="size-10" />
        <span className="flex-1 space-y-2">
          <Skeleton tone="page" className="h-3.5 w-2/5" />
          <Skeleton tone="page" className="h-3 w-1/3" />
        </span>
      </div>
    ));
  const personRow = (key: string, initial: string, name: string, detail: string, onDelete: () => void) => (
    <div key={key} className="flex items-center gap-3 py-3.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-surface)] text-[14px] font-semibold uppercase shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)]">
        {initial.trim().charAt(0) || "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{name}</span>
        <span className="block truncate text-[13px] text-[var(--lp-muted)]" title={detail}>
          {shortenDetail(detail)}
        </span>
      </span>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Remove ${name}`}
        className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-danger-soft)] hover:text-[var(--lp-danger)]"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
  const emptyRow = (text: string, cta: string, onClick: () => void) => (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <p className="text-[15px] text-[var(--lp-muted)]">{text}</p>
      <button type="button" onClick={onClick} className="text-[14px] font-semibold underline-offset-2 hover:underline">
        {cta}
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1100px] pb-24">
      <DocHeader
        eyebrow="Settings"
        title="Your"
        italic="account."
        lead="Who you are, what protects your money, who you pay and how we reach you. Anything that weakens a protection asks you to confirm it's you first."
        meta={userEmail ? `Signed in as ${userEmail}` : undefined}
      />

      <div className="mt-12 lg:mt-20">
        <DocBody items={nav}>
          <DocSection id="account" number={1} title="Your account" description="One smart account that works across every network Sendzz supports. Sendzz never holds your keys.">
            <DocRows>
              <SettingsRow title="Email" description="How you sign in and how people pay you." control={<span className="max-w-[220px] truncate text-[15px] font-semibold" title={userEmail}>{userEmail || "Not set"}</span>} />
              <SettingsRow title="Smart account" description={`Active, and works on ${networkCount} networks.`} control={<span className="rounded-full bg-[var(--lp-good-soft)] px-3 py-1 text-[13px] font-semibold text-[var(--lp-good)]">Active</span>} />
              {/* What protects the money, as a meter of the four things that can. */}
              <div className="py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[17px] font-semibold">Your protection</span>
                  <span className="text-[15px] text-[var(--lp-muted)]">
                    {isSecurityLoading ? "Checking…" : `${protectionsOn} of ${protections.length} on`}
                  </span>
                </div>
                <ul className="mt-3 grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-4">
                  {protections.map((p) => (
                    <li key={p.label}>
                      <span className={cn("block h-1.5 rounded-full transition-colors duration-500", !isSecurityLoading && p.on ? "bg-[#04c96a]" : "bg-[var(--lp-rule)]")} />
                      <span className={cn("mt-2 block text-[13px]", p.on ? "font-medium text-[var(--lp-ink)]" : "text-[var(--lp-muted)]")}>{p.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </DocRows>
          </DocSection>

          {/* Anchored as "identity" too: the limit modal links straight here. */}
          <DocSection
            id="verification"
            number={2}
            title="Verification"
            description="A one-time identity check. Sending, receiving and adding money never need it; it only lifts the limit on cashing out."
          >
            <div id="identity" className="scroll-mt-24 space-y-5">
              {isKycLoading ? (
                <div className="space-y-3">
                  <Skeleton tone="page" className="h-4 w-1/3" />
                  <Skeleton tone="page" className="h-2" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[17px]">
                      Status: <span className="font-semibold">{kycLabel}</span>
                    </p>
                    {kycStatus !== "approved" && kycStatus !== "in_review" && (
                      <button
                        id="settings-kyc-verify-btn"
                        type="button"
                        onClick={() => setKycModalOpen(true)}
                        className="lp-fixed inline-flex h-[46px] items-center rounded-full bg-[var(--lp-green)] px-[22px] text-[15px] font-semibold text-[var(--lp-ink)] transition-transform duration-150 hover:-translate-y-px"
                      >
                        {kycStatus === "declined" ? "Try again" : "Verify my identity"}
                      </button>
                    )}
                  </div>
                  {kycData && <LimitsMeter allowance={kycData.allowance} isVerified={verified} />}
                </>
              )}
            </div>
          </DocSection>

          <DocSection id="security" number={3} title="Security" description="What approves money leaving your account. Your PIN approves every payment; the rest add a second check to large withdrawals.">
            <DocRows>
              {isSecurityLoading ? (
                skeletonRows(4)
              ) : (
                <>
                  {/* No "remove" for the PIN: it gates every outgoing transaction, so taking it away
                      would leave the account unable to send at all. Change it, or reset it by email. */}
                  <SettingsRow
                    title="Transaction PIN"
                    description={pinEnabled ? "Asked for every time money goes out." : "Not set up yet. Nothing can be sent without it."}
                    control={
                      pinEnabled ? (
                        <>
                          <RowAction onClick={() => setForgotPinOpen(true)} tone="danger">
                            Forgot it?
                          </RowAction>
                          <RowAction onClick={() => setPinSetupOpen(true)}>Change</RowAction>
                        </>
                      ) : (
                        <RowAction onClick={() => setPinSetupOpen(true)} tone="primary">
                          Set up
                        </RowAction>
                      )
                    }
                  />
                  <SettingsRow
                    title="Check large withdrawals"
                    description="Ask for a second check above your limit."
                    control={
                      <Switch
                        label="Check large withdrawals"
                        checked={twoFaEnabled}
                        disabled={isUpdatingSecurity}
                        onChange={withStepUp({
                          title: twoFaEnabled ? "Turn off verification" : "Turn on verification",
                          description: twoFaEnabled
                            ? "Large withdrawals will stop asking for a second check. Confirm this first."
                            : "Large withdrawals will ask for a second check. Confirm this first.",
                          confirmLabel: twoFaEnabled ? "Turn off" : "Turn on",
                          destructive: twoFaEnabled,
                          control: "two_fa",
                          run: (authorization) => {
                            const checked = !twoFaEnabled;
                            setTwoFaEnabled(checked);
                            updateSecurityPrefs(checked, twoFaThreshold, authorization);
                          },
                        })}
                      />
                    }
                  />
                  <SettingsRow
                    title="Your limit"
                    description={twoFaEnabled ? "Withdrawals above this ask for the second check." : "Turn on the check above to set a limit."}
                    muted={!twoFaEnabled}
                    control={
                      <button
                        type="button"
                        disabled={!twoFaEnabled}
                        onClick={withStepUp({
                          title: "Change verification threshold",
                          description:
                            "Raising the threshold means more can be withdrawn without a second check. Confirm this first.",
                          confirmLabel: "Continue",
                          control: "threshold",
                          run: (authorization) => {
                            setThresholdAuthorization(authorization);
                            setThresholdValue(twoFaThreshold);
                            setThresholdModalOpen(true);
                          },
                        })}
                        className="lp-display inline-flex h-10 items-center rounded-full bg-[var(--lp-surface)] px-4 text-[18px] tabular-nums tracking-[-0.02em] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)] disabled:opacity-50"
                      >
                        ${twoFaThreshold}
                      </button>
                    }
                  />
                  <SettingsRow
                    title="Authenticator app"
                    description={totpEnabled ? "On. Codes from your app approve the second check." : "Use a code from an app instead of email."}
                    control={
                      totpEnabled ? (
                        <RowAction
                          tone="danger"
                          onClick={withStepUp({
                            title: "Remove authenticator app",
                            description:
                              "Codes from your authenticator app will no longer be accepted. You can pair an app again at any time.",
                            confirmLabel: "Remove app",
                            destructive: true,
                            control: "totp",
                            run: handleDisableTotp,
                          })}
                        >
                          Remove
                        </RowAction>
                      ) : (
                        <RowAction
                          tone="primary"
                          onClick={withStepUp({
                            title: "Add authenticator app",
                            description: "Confirm it is you before adding a new way to approve withdrawals.",
                            confirmLabel: "Continue",
                            control: "totp",
                            run: () => setTotpSetupOpen(true),
                          })}
                        >
                          Set up
                        </RowAction>
                      )
                    }
                  />
                  <SettingsRow
                    title="Passkey"
                    description={passkeyEnabled ? "On. Your face or fingerprint approves the second check." : "Approve with your face or fingerprint."}
                    control={
                      passkeyEnabled ? (
                        <RowAction
                          tone="danger"
                          onClick={withStepUp({
                            title: "Remove passkey",
                            description:
                              "Every passkey on your account is removed. Withdrawals will fall back to your other methods.",
                            confirmLabel: "Remove passkey",
                            destructive: true,
                            control: "passkey",
                            run: handleDisablePasskey,
                          })}
                        >
                          Remove
                        </RowAction>
                      ) : (
                        <RowAction
                          tone="primary"
                          onClick={withStepUp({
                            title: "Add passkey",
                            description: "Confirm it is you before adding a new way to approve withdrawals.",
                            confirmLabel: "Continue",
                            control: "passkey",
                            run: () => setPasskeySetupOpen(true),
                          })}
                        >
                          Set up
                        </RowAction>
                      )
                    }
                  />
                </>
              )}
            </DocRows>
          </DocSection>

          <DocSection
            id="recipients"
            number={4}
            title="Saved recipients"
            description="Suggested when you send by email."
            action={addButton("Add", () => setAddEmailModalOpen(true))}
          >
            <DocRows>
              {isEmailLoading
                ? skeletonRows(2)
                : emailContacts.length === 0
                  ? emptyRow("No saved recipients yet.", "Add your first one", () => setAddEmailModalOpen(true))
                  : emailContacts.map((c) =>
                      personRow(c.id, c.name || c.email, c.name || c.email, c.email, () => setEmailContactToDelete({ id: c.id, name: c.name || c.email })),
                    )}
            </DocRows>
          </DocSection>

          <DocSection
            id="banks"
            number={5}
            title="Bank accounts"
            description="Ready to pick when you cash out."
            action={addButton("Add", handleOpenAddBankModal)}
          >
            <DocRows>
              {isBankLoading
                ? skeletonRows(2)
                : bankContacts.length === 0
                  ? emptyRow("No saved bank accounts yet.", "Add your first one", handleOpenAddBankModal)
                  : bankContacts.map((c) =>
                      personRow(c.id, c.account_name, c.account_name, `${c.bank_name} · ${c.account_number}`, () =>
                        setContactToDelete({ id: c.id, name: c.account_name }),
                      ),
                    )}
            </DocRows>
          </DocSection>

          <DocSection id="preferences" number={6} title="Preferences" description="How Sendzz looks and reaches you.">
            <DocRows>
              <SettingsRow
                title="Dark mode"
                description="Easier on the eyes at night. Saved on this device."
                control={<Switch label="Dark mode" checked={theme === "dark"} onChange={() => setTheme(theme === "dark" ? "light" : "dark")} />}
              />
              <SettingsRow
                title="Hide balances"
                description="Show •••• instead of amounts, for when someone is looking over your shoulder."
                control={<Switch label="Hide balances" checked={hideBalance} onChange={toggleBalanceVisibility} />}
              />
              <SettingsRow title="Notifications" description="Choose what reaches your phone and your inbox." href="/dashboard/settings/notifications" />
              <SettingsRow title="Devices" description="See where you are signed in and sign out a lost device." href="/dashboard/settings/devices" />
              {/* Always offered while the app is not installed. The browser's own banner appears once
                  and never returns once dismissed, so this is the only way back to it. */}
              <SettingsRow title="Install Sendzz" description="Add it to your home screen and open it like an app." control={<InstallAppButton compact />} />
              <SettingsRow title="Language" description="More languages are on the way." control={<span className="text-[15px] font-semibold">English (US)</span>} />
            </DocRows>
          </DocSection>

          <DocSection id="sign-out" number={7} title="Signing out" description="Signs you out on this device. To sign out somewhere else, use Devices.">
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex h-[46px] items-center gap-2 rounded-full border border-[var(--lp-danger)]/35 px-[22px] text-[15px] font-semibold text-[var(--lp-danger)] transition-colors hover:bg-[var(--lp-danger-soft)]"
            >
              <LogOut className="size-4" /> Sign out of Sendzz
            </button>
          </DocSection>

          <DocReadNext
            title="Fees and questions"
            body="What everything costs, and plain answers to what people ask most."
            href="/dashboard/settings/fees"
          />
        </DocBody>
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

      {/* The limit, typed into its own small dialog once the change has been confirmed. */}
      <FlowDialog
        open={thresholdModalOpen}
        onClose={() => setThresholdModalOpen(false)}
        eyebrow="Large withdrawal check"
        title="Set"
        italic="your limit."
        description="Withdrawals above this amount ask for a second check. Anything below goes straight through, so a lower figure is the safer one."
      >
          <div>
            <AmountField
              label="Limit"
              value={thresholdValue}
              onChange={(v) => {
                const val = parseFloat(v);
                if (val > 500) setThresholdValue("500");
                else if (val < 0) setThresholdValue("0");
                else setThresholdValue(v);
              }}
              symbol="$"
              currency={<CurrencyPill>USDC</CurrencyPill>}
              placeholder="500"
              footer={
                <div className="flex flex-wrap items-center gap-1.5">
                  {["100", "250", "500"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setThresholdValue(v)}
                      className={cn(
                        "h-8 rounded-full px-3 text-[13px] font-semibold",
                        thresholdValue === v ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "bg-[var(--lp-cream)] hover:bg-[var(--lp-sand)]",
                      )}
                    >
                      ${v}
                    </button>
                  ))}
                  <span className="ml-auto text-[13px] text-[var(--lp-muted)]">The most is $500</span>
                </div>
              }
            />
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
            <FlowButton tone="quiet" onClick={() => setThresholdModalOpen(false)} className="sm:w-32">
              Cancel
            </FlowButton>
            <FlowButton onClick={handleThresholdUpdate} loading={isUpdatingSecurity} className="sm:flex-1">
              Save limit
            </FlowButton>
          </div>
      </FlowDialog>

      {/* One dialog for every change that weakens a protection. */}
      <SecurityStepUp request={stepUp} onClose={() => setStepUp(null)} />

      {/*
        Both mounts refresh BOTH methods. The wizard offers to add the other once one is set,
        so a PIN can be created from the passkey flow and vice versa — refreshing only the one
        the row is named after would leave the other showing "Not set up" until a reload, and
        the user would set it a second time.
      */}
      <PasskeySetupWizard
        open={passkeySetupOpen}
        onOpenChange={setPasskeySetupOpen}
        onComplete={refreshSecurityStatus}
      />

      {/* Same wizard, opened straight on the PIN step from its own row. */}
      <PasskeySetupWizard
        open={pinSetupOpen}
        onOpenChange={setPinSetupOpen}
        initialMethod="pin"
        onComplete={refreshSecurityStatus}
      />

      <ForgotPinDialog
        open={forgotPinOpen}
        onOpenChange={setForgotPinOpen}
        // Shown to the user ("code goes to ..."), not used to address the mail — the server
        // sends to the session's own address regardless.
        email={userEmail}
        onReset={refreshSecurityStatus}
      />

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
