"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Fingerprint, CheckCircle2, Loader2 } from "lucide-react";

interface PasskeySetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onComplete: () => void;
}

type Step = "intro" | "registering" | "success";

export function PasskeySetupWizard({
  open,
  onOpenChange,
  email,
  onComplete,
}: PasskeySetupWizardProps) {
  const [step, setStep] = useState<Step>("intro");
  const [loading, setLoading] = useState(false);

  const handleStartRegistration = async () => {
    setLoading(true);
    setStep("registering");

    try {
      // Step 1: Generate registration options
      const res = await fetch("/api/2fa/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, action: "generate-options" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate options");

      const { options, challengeId } = data;

      // Step 2: Start WebAuthn registration
      const registrationResponse = await startRegistration(options);

      // Step 3: Verify registration
      const verifyRes = await fetch("/api/2fa/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          action: "verify-registration",
          credential: registrationResponse,
          challengeId,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok)
        throw new Error(verifyData.error || "Verification failed");

      setStep("success");
      setTimeout(() => {
        onComplete();
        onOpenChange(false);
        setStep("intro");
      }, 2000);
    } catch (err) {
      // Don't show error toast if user cancelled
      const errorMessage =
        err instanceof Error ? err.message : "Passkey registration failed";
      if (
        !errorMessage.includes("cancelled") &&
        !errorMessage.includes("aborted")
      ) {
        toast.error("Passkey registration failed. Please try again.");
      }
      setStep("intro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {step === "intro" && "Set up Passkey"}
            {step === "registering" && "Registering Passkey"}
            {step === "success" && "Passkey Enabled"}
          </DialogTitle>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <Fingerprint className="w-5 h-5 mt-0.5 text-primary" />
              <div>
                <p className="font-medium">Use device biometrics</p>
                <p className="text-sm text-muted-foreground">
                  Face ID, Touch ID, or Windows Hello for quick access
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <CheckCircle2 className="w-5 h-5 mt-0.5 text-primary" />
              <div>
                <p className="font-medium">No codes to remember</p>
                <p className="text-sm text-muted-foreground">
                  Your device handles authentication securely
                </p>
              </div>
            </div>
            <Button
              onClick={handleStartRegistration}
              disabled={loading}
              className="w-full"
            >
              {loading ? "Starting..." : "Set up Passkey"}
            </Button>
          </div>
        )}

        {step === "registering" && (
          <div className="space-y-4 py-4 text-center">
            <Loader2 className="w-16 h-16 mx-auto animate-spin text-primary" />
            <p className="text-lg font-medium">Registering your passkey...</p>
            <p className="text-sm text-muted-foreground">
              Follow the prompts on your device to complete registration
            </p>
          </div>
        )}

        {step === "success" && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
            <p className="text-lg font-medium">Passkey enabled!</p>
            <p className="text-sm text-muted-foreground">
              Your account is now protected with biometric authentication
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
