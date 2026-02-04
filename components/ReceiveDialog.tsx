'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowDownLeft, Check, Copy, QrCode } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface ReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}

export function ReceiveDialog({
  open,
  onOpenChange,
  email,
}: ReceiveDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(email);
    setCopied(true);
    toast.success('Email copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-green-600" />
            Receive Money
          </DialogTitle>
          <DialogDescription>
            Share your email address to receive funds instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-6 space-y-6">
          <div className="relative group">
            <div className="absolute inset-0 bg-green-200 rounded-full blur-xl opacity-20 group-hover:opacity-30 transition-opacity" />
            <div className="w-24 h-24 bg-white border-2 border-green-100 rounded-2xl flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-transform duration-300">
              <QrCode className="w-12 h-12 text-green-600" />
            </div>
          </div>

          <div className="text-center space-y-2 max-w-[80%]">
            <h3 className="font-semibold text-lg">Your Sendzz ID</h3>
            <p className="text-sm text-muted-foreground">
              Other Sendzz users can send you money using this email address.
            </p>
          </div>

          <div className="w-full space-y-2">
            <Label htmlFor="email-copy" className="sr-only">
              Your Email
            </Label>
            <div className="relative flex items-center">
              <Input
                id="email-copy"
                value={email}
                readOnly
                className="pr-12 bg-slate-50 font-medium text-center"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 w-8 h-8 hover:bg-slate-200"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-center">
          <Button
            className="w-full sm:w-auto bg-green-600 hover:bg-green-700 font-bold"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied Address
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Address
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
