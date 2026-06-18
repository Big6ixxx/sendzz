"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ConnectedWallet } from "@privy-io/react-auth";
import { Users, X } from "lucide-react";
import { AmountConfig } from "./AmountConfig";
import { ConfirmStep } from "./ConfirmStep";
import { ExecutionStatus } from "./ExecutionStatus";
import { RecipientList } from "./RecipientList";
import { ReviewSummary } from "./ReviewSummary";
import { Step, useBatchSend } from "./useBatchSend";
import { TwoFactorModal } from "@/components/TwoFactorModal";

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
}

const STEPS: { key: Step; label: string }[] = [
  { key: "recipients", label: "People" },
  { key: "amount", label: "Amount" },
  { key: "preview", label: "Review" },
  { key: "confirm", label: "Confirm" },
];

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  if (idx === -1) return null;

  return (
    <div className="grid grid-cols-4 gap-3 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.key} className="space-y-2">
          <div
            className={cn(
              "h-1 rounded-full transition-all duration-500",
              i <= idx ? "bg-foreground" : "bg-muted",
            )}
          />
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-widest block text-center",
              i === idx ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
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
}: BatchSendDialogProps) {
  const hook = useBatchSend(
    maxAmount,
    smartAddress,
    senderEmail,
    embeddedProvider,
    twoFaThreshold,
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
        className="sm:max-w-2xl p-0 overflow-hidden border-none rounded-3xl shadow-2xl bg-background flex flex-col max-h-[90vh]"
        onPointerDownOutside={(e) =>
          (hook.step === "processing" || hook.twoFaModalOpen) &&
          e.preventDefault()
        }
        onEscapeKeyDown={(e) =>
          (hook.step === "processing" || hook.twoFaModalOpen) &&
          e.preventDefault()
        }
      >
        <DialogHeader className="p-8 pb-0 flex flex-row items-start justify-between shrink-0">
          <div className="space-y-1">
            <DialogTitle className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
              <div className="p-2 bg-foreground text-background rounded-xl">
                <Users className="w-6 h-6" />
              </div>
              Send to Many
            </DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {hook.step === "recipients" && "Who are you sending to?"}
              {hook.step === "amount" && "Set individual payout amounts"}
              {hook.step === "preview" && "Review your recipient list"}
              {hook.step === "confirm" && "Authorize fund dispatch"}
              {hook.step === "processing" && "Broadcasting transactions"}
              {hook.step === "results" && "Transfer cycle complete"}
            </DialogDescription>
          </div>
          <button
            onClick={handleClose}
            className={cn(
              "p-2 hover:bg-muted rounded-full transition-colors",
              hook.step === "processing" && "hidden",
            )}
          >
            <X className="w-6 h-6" />
          </button>
        </DialogHeader>

        <div className="p-8 pt-6 flex-1 overflow-hidden flex flex-col">
          {hook.step !== "processing" && hook.step !== "results" && (
            <Stepper current={hook.step} />
          )}

          <div className="flex-1 overflow-y-auto pr-1 -mr-1">
            {hook.step === "recipients" && (
              <RecipientList hook={hook} senderEmail={senderEmail} />
            )}
            {hook.step === "amount" && (
              <AmountConfig hook={hook} maxAmount={maxAmount} />
            )}
            {hook.step === "preview" && <ReviewSummary hook={hook} />}
            {hook.step === "confirm" && <ConfirmStep hook={hook} />}
            {(hook.step === "processing" || hook.step === "results") && (
              <ExecutionStatus hook={hook} onClose={handleClose} />
            )}
          </div>
        </div>
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
