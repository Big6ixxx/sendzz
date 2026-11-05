"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { DepositForm } from "./DepositForm";
import { ReceiveCryptoFlow } from "./ReceiveCryptoFlow";
import { FlowType, useDepositWithdraw } from "./useDepositWithdraw";
import { WithdrawForm } from "./WithdrawForm";
import { TwoFactorModal } from "@/components/TwoFactorModal";
import { FlowFrameProvider, FlowTabs } from "@/components/flow/ui";
import { type ChainBalances, type SolanaSource } from "@/lib/web3/routing";

type DepositTab = "fiat" | "usdc";

interface DepositWithdrawDialogProps {
  isOpen: boolean;
  onClose: () => void;
  type: FlowType;
  userId: string;
  userAddress: string;
  solanaAddress?: string;
  stellarAddress?: string;
  stellarWalletId?: string;
  stellarTrustlineReady?: boolean;
  balance: string;
  chainBalances?: ChainBalances;
  solanaSource?: SolanaSource;
  stellarBalance?: number;
  userEmail: string;
  embeddedProvider?: ConnectedWallet;
}

export function DepositWithdrawDialog({
  isOpen,
  onClose,
  type,
  userId,
  userAddress,
  solanaAddress,
  stellarAddress,
  stellarWalletId,
  stellarTrustlineReady,
  balance,
  chainBalances,
  solanaSource,
  stellarBalance = 0,
  userEmail,
  embeddedProvider,
}: DepositWithdrawDialogProps) {
  const [depositTab, setDepositTab] = useState<DepositTab>("fiat");

  const depositHook = useDepositWithdraw(
    "deposit",
    userAddress,
    userEmail,
    userId,
    balance,
    embeddedProvider,
    onClose,
    chainBalances,
    solanaSource,
    stellarAddress,
    stellarWalletId,
    stellarBalance,
  );

  const withdrawHook = useDepositWithdraw(
    "withdraw",
    userAddress,
    userEmail,
    userId,
    balance,
    embeddedProvider,
    onClose,
    chainBalances,
    solanaSource,
    stellarAddress,
    stellarWalletId,
    stellarBalance,
  );

  const handleClose = () => {
    depositHook.reset();
    withdrawHook.reset();
    setDepositTab("fiat");
    onClose();
  };

  /**
   * Undo a stuck pointer lock once nothing of ours is open.
   *
   * Radix sets `body { pointer-events: none }` for the duration of a modal dialog and clears it
   * on close. This flow nests dialogs (the bank-contact modal opens inside this one), and a
   * nested pair closing together can miss that restore — which leaves the whole page dead to
   * clicks, this dialog's own X button included. That is exactly the "modal won't close"
   * symptom: the click never reaches the button.
   *
   * Only clears when no dialog remains in the DOM, so it cannot unlock the page underneath a
   * dialog that is legitimately still open. A no-op when Radix already cleaned up.
   */
  useEffect(() => {
    if (isOpen) return;
    const id = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"],[data-slot="dialog-content"]')) {
        document.body.style.pointerEvents = "";
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  // Reset on every open so a prior completed flow doesn't leave stale state behind.
  // (Programmatic auto-close after success doesn't trigger onOpenChange/handleClose,
  // so resetting on open is the reliable place to clear it.)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      depositHook.reset();
      withdrawHook.reset();
      setDepositTab("fiat");
    }
    wasOpen.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Money is in flight — the dialog must not be dismissable out from under a signature or a
  // broadcast that is still resolving. Everything else, including the success screen, closes
  // freely on outside-click, Escape, or the X.
  const isBusy = withdrawHook.transferring || withdrawHook.loading;

  return (
    <>
      {/* The dialog stays MOUNTED while the 2FA modal is up. It used to be unmounted outright
          to stop its backdrop swallowing clicks, but tearing down a Radix dialog while it is
          still open skips the cleanup that releases `body { pointer-events: none }` — leaving
          the page unclickable afterwards. `modal={false}` drops the pointer lock and focus trap
          instead, which is what made the backdrop block in the first place, without unmounting. */}
      <Dialog
        open={isOpen}
        onOpenChange={(val) => !val && handleClose()}
        modal={!withdrawHook.twoFaModalOpen}
      >
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => {
            // While 2FA is up, a click on THAT modal reads as "outside" this one — closing
            // here would take the withdrawal down mid-verification.
            if (isBusy || withdrawHook.twoFaModalOpen) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (isBusy || withdrawHook.twoFaModalOpen) e.preventDefault();
          }}
          className={cn(
            // Phones: a full-screen sheet. From sm up: a tall card, wide enough on desktop for the
            // form beside its forest panel (see FlowFrame).
            "gap-0 p-0 overflow-hidden flex flex-col",
            "max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-w-none max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none",
            "sm:h-[min(800px,calc(100dvh-3rem))] sm:max-w-[600px]",
            "lg:max-w-[1000px]",
          )}
        >
          {/* Radix wants a title and description for screen readers; the visible header is the
              brand's (FlowFrame), so these stay for assistive tech only. */}
          <DialogTitle className="sr-only">{type === "deposit" ? "Add money" : "Send money to a bank"}</DialogTitle>
          <DialogDescription className="sr-only">
            {type === "deposit" ? "Fund your balance from a bank or a crypto wallet" : "Send money to a bank or mobile money account"}
          </DialogDescription>

          <FlowFrameProvider
            value={{
              eyebrow: type === "deposit" ? "Deposit" : "Withdraw",
              title: type === "deposit" ? "Add money" : "Send money",
              italic: type === "deposit" ? "to your balance." : "to a bank.",
              onClose: handleClose,
              closeDisabled: isBusy,
              tabs:
                type === "deposit" ? (
                  <FlowTabs
                    label="How you're adding money"
                    options={[
                      { label: "From your bank", value: "fiat" },
                      { label: "From a crypto wallet", value: "usdc" },
                    ]}
                    value={depositTab}
                    onChange={setDepositTab}
                  />
                ) : undefined,
            }}
          >
            {type === "deposit" ? (
              depositTab === "fiat" ? (
                <DepositForm hook={depositHook} />
              ) : (
                <ReceiveCryptoFlow
                  evmAddress={userAddress}
                  solanaAddress={solanaAddress}
                  stellarAddress={stellarAddress}
                  stellarTrustlineReady={stellarTrustlineReady}
                />
              )
            ) : (
              <WithdrawForm hook={withdrawHook} />
            )}
          </FlowFrameProvider>
        </DialogContent>
      </Dialog>

      {/* 2FA Modal — rendered above the dialog (its own portal at z-[9999]); the dialog drops
          to non-modal while it is open so the pointer lock does not swallow these clicks. */}
      {type === "withdraw" && (
        <TwoFactorModal
          isOpen={withdrawHook.twoFaModalOpen}
          onClose={() => withdrawHook.setTwoFaModalOpen(false)}
          onSubmit={withdrawHook.handleTwoFaSubmit}
          onResend={withdrawHook.handleTwoFaResend}
          loading={withdrawHook.twoFaLoading}
          error={withdrawHook.twoFaError}
          method={
            withdrawHook.totpEnabled
              ? "totp"
              : withdrawHook.passkeyEnabled
                ? "passkey"
                : "email"
          }
          availableMethods={(() => {
            // Email, authenticator and passkey — never the PIN.
            //
            // The PIN was already entered to get here: it gates every outgoing transaction.
            // Offering it again as the "second factor" on a large withdrawal would mean one
            // secret satisfying both checks, which is one check wearing two hats. A second
            // factor has to be something else you hold.
            const methods: ("email" | "totp" | "passkey")[] = ["email"];
            if (withdrawHook.totpEnabled) methods.push("totp");
            if (withdrawHook.passkeyEnabled) methods.push("passkey");
            return methods;
          })()}
          userEmail={userEmail}
        />
      )}
    </>
  );
}
