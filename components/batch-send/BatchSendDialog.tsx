"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ConnectedWallet } from "@privy-io/react-auth";
import { AmountConfig } from "./AmountConfig";
import { ConfirmStep } from "./ConfirmStep";
import { ExecutionStatus } from "./ExecutionStatus";
import { RecipientList } from "./RecipientList";
import { ReviewSummary } from "./ReviewSummary";
import { useBatchSend } from "./useBatchSend";
import { TwoFactorModal } from "@/components/TwoFactorModal";
import { FlowFrameProvider } from "@/components/flow/ui";
import { type ChainBalances, type SolanaSource, type StellarSource } from "@/lib/web3/routing";

interface BatchSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxAmount: number;
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  senderEmail: string;
  twoFaThreshold?: number;
  totpEnabled?: boolean;
  passkeyEnabled?: boolean;
  chainBalances?: ChainBalances;
  solanaSource?: SolanaSource;
  stellarSource?: StellarSource;
}

export function BatchSendDialog({
  open,
  onOpenChange,
  maxAmount,
  smartAddress,
  embeddedProvider,
  senderEmail,
  twoFaThreshold = 500,
  totpEnabled = false,
  passkeyEnabled = false,
  chainBalances,
  solanaSource,
  stellarSource,
}: BatchSendDialogProps) {
  const hook = useBatchSend(
    maxAmount,
    smartAddress,
    senderEmail,
    embeddedProvider,
    twoFaThreshold,
    chainBalances,
    solanaSource,
    stellarSource,
  );

  const handleClose = () => {
    if (hook.step === "processing") return;
    if (hook.twoFaModalOpen) return; // Don't close if 2FA modal is open
    hook.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // The same frame as the deposit and withdraw dialogs (see FlowFrame).
          "gap-0 p-0 overflow-hidden flex flex-col",
          "max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-w-none max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none",
          "sm:h-[min(800px,calc(100dvh-3rem))] sm:max-w-[600px] lg:max-w-[1000px]",
        )}
        onPointerDownOutside={(e) => (hook.step === "processing" || hook.twoFaModalOpen) && e.preventDefault()}
        onEscapeKeyDown={(e) => (hook.step === "processing" || hook.twoFaModalOpen) && e.preventDefault()}
      >
        <DialogTitle className="sr-only">Send to many people</DialogTitle>
        <DialogDescription className="sr-only">Pay a list of people by email in one go</DialogDescription>
        <FlowFrameProvider
          value={{
            eyebrow: "Batch send",
            title: "Pay everyone",
            italic: "at once.",
            onClose: handleClose,
            closeDisabled: hook.step === "processing",
          }}
        >
          {hook.step === "recipients" && <RecipientList hook={hook} senderEmail={senderEmail} />}
          {hook.step === "amount" && <AmountConfig hook={hook} maxAmount={maxAmount} />}
          {hook.step === "preview" && <ReviewSummary hook={hook} />}
          {hook.step === "confirm" && <ConfirmStep hook={hook} />}
          {(hook.step === "processing" || hook.step === "results") && <ExecutionStatus hook={hook} onClose={handleClose} />}
        </FlowFrameProvider>
      </DialogContent>

      <TwoFactorModal
        isOpen={hook.twoFaModalOpen}
        onClose={() => hook.setTwoFaModalOpen(false)}
        onSubmit={hook.handleTwoFaSubmit}
        onResend={hook.handleTwoFaResend}
        userEmail={senderEmail}
        method={passkeyEnabled ? "passkey" : totpEnabled ? "totp" : "email"}
        availableMethods={[
          ...(passkeyEnabled ? ["passkey" as const] : []),
          ...(totpEnabled ? ["totp" as const] : []),
          "email" as const,
        ]}
        loading={hook.twoFaLoading}
        error={hook.twoFaError}
      />
    </Dialog>
  );
}
