'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Plus, RefreshCw, Send, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AddContactDialog } from './AddContactDialog';

interface SendMoneyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxAmount: number;
}

export function SendMoneyDialog({
  open,
  onOpenChange,
  maxAmount,
}: SendMoneyDialogProps) {
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'NGN'>('USD');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [result, setResult] = useState<{ claimRequired: boolean } | null>(null);

  // New Contact
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactEmail, setNewContactEmail] = useState('');

  // Contacts
  const [contacts, setContacts] = useState<
    { id: string; name: string; email: string }[]
  >([]);
  const [showContacts, setShowContacts] = useState(false);

  useEffect(() => {
    if (open) {
      fetchContacts();
    }
  }, [open]);

  const fetchContacts = () => {
    fetch('/api/contacts')
      .then((res) => res.json())
      .then((data) => {
        if (data.contacts) setContacts(data.contacts);
      })
      .catch(console.error);
  };

  const handleContactAdded = (contact: { email: string }) => {
    fetchContacts();
    setEmail(contact.email);
    setShowAddContact(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Convert to USD for validation and sending
    const usdAmount = currency === 'NGN' ? amountNum / 1500 : amountNum;

    if (usdAmount > maxAmount) {
      toast.error('Insufficient balance');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/transfer/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: email,
          amount: usdAmount.toString(),
          note: note || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send');
      }

      setResult({ claimRequired: data.claimRequired });
      setStep('success');
      toast.success('Transfer sent! 🎉');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send');
    }
    setLoading(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset form after animation
    setTimeout(() => {
      setStep('form');
      setEmail('');
      setAmount('');
      setCurrency('USD');
      setNote('');
      setResult(null);
      setNewContactEmail('');
    }, 200);
  };

  const formatAmount = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === 'form' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-blue-600" />
                Send USDC
              </DialogTitle>
              <DialogDescription>
                Send USDC to any email address instantly.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              {/* Recipient Email */}
              <div className="space-y-2">
                <Label htmlFor="recipient">Recipient Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground z-10" />
                  <div className="relative">
                    <Input
                      id="recipient"
                      type="email"
                      required
                      placeholder="friend@example.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setShowContacts(true);
                      }}
                      onFocus={() => setShowContacts(true)}
                      onBlur={() =>
                        setTimeout(() => setShowContacts(false), 200)
                      }
                      disabled={loading}
                      autoComplete="off"
                    />
                    {/* Contacts Dropdown */}
                    {showContacts && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md z-50 max-h-[200px] overflow-auto">
                        {contacts
                          .filter(
                            (c) =>
                              c.name
                                .toLowerCase()
                                .includes(email.toLowerCase()) ||
                              c.email
                                .toLowerCase()
                                .includes(email.toLowerCase()),
                          )
                          .map((contact) => (
                            <button
                              key={contact.id}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-3 transition-colors"
                              onClick={() => {
                                setEmail(contact.email);
                                setShowContacts(false);
                              }}
                            >
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                                {contact.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium">
                                  {contact.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {contact.email}
                                </p>
                              </div>
                            </button>
                          ))}

                        {/* Add Contact Option */}
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2 text-blue-600 border-t"
                          onMouseDown={(e) => {
                            e.preventDefault(); // Prevent input blur
                            setNewContactEmail(email); // Pre-fill email
                            setShowAddContact(true);
                            setShowContacts(false);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">
                            Add new contact
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="amount">Amount ({currency})</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={() => {
                      const newCurrency = currency === 'USD' ? 'NGN' : 'USD';
                      setCurrency(newCurrency);
                      setAmount(''); // Reset to avoid confusion or we could convert
                    }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Switch to {currency === 'USD' ? 'NGN' : 'USD'}
                  </Button>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground mb-1">
                  <span>Max: {formatAmount(maxAmount)} USD</span>
                  {currency === 'NGN' && (
                    <span>≈ ₦{(maxAmount * 1500).toLocaleString()}</span>
                  )}
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">
                    {currency === 'NGN' ? '₦' : '$'}
                  </span>
                  <Input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    className="pl-8 pr-16 text-lg font-semibold"
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setAmount(val);
                    }}
                    disabled={loading}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">
                    {currency}
                  </span>
                </div>
                {currency === 'NGN' && amount && (
                  <p className="text-xs text-muted-foreground text-right mt-1">
                    ≈ ${(parseFloat(amount) / 1500).toFixed(2)} USD
                  </p>
                )}

                {/* Quick amounts */}
                <div className="flex gap-2 mt-2">
                  {[5, 10, 25, 50, 100].map((baseAmount) => {
                    const chipAmount =
                      currency === 'NGN' ? baseAmount * 1500 : baseAmount;
                    const displayAmount =
                      currency === 'NGN'
                        ? `₦${chipAmount.toLocaleString()}`
                        : `$${chipAmount}`;

                    // Check max balance in USD
                    const equivalentUsd =
                      currency === 'NGN' ? chipAmount / 1500 : chipAmount;
                    const isDisabled = equivalentUsd > maxAmount || loading;

                    return (
                      <Button
                        key={baseAmount}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setAmount(chipAmount.toString())}
                        disabled={isDisabled}
                      >
                        {displayAmount}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Note */}
              <div className="space-y-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Input
                  id="note"
                  type="text"
                  placeholder="What's this for?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={loading}
                  maxLength={200}
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !email || !amount}
                className="w-full h-12 font-bold bg-linear-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send {amount ? `$${amount}` : 'USDC'}
                  </>
                )}
              </Button>
            </form>
          </>
        ) : (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Transfer Sent! 🎉</h3>
            <p className="text-muted-foreground mb-4">
              {result?.claimRequired
                ? `We've sent ${email} an email with a link to claim their funds.`
                : `${email} has received ${amount} USDC instantly!`}
            </p>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>

      <AddContactDialog
        open={showAddContact}
        onOpenChange={setShowAddContact}
        onContactAdded={handleContactAdded}
        defaultEmail={newContactEmail}
      />
    </Dialog>
  );
}
