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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Mail,
  Wallet,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface ReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  userId?: string;
}

// Supported chains for USDC deposits via Circle Gateway
const SUPPORTED_CHAINS = [
  {
    id: 'solana',
    name: 'Solana',
    icon: '◎',
    description: 'Fast & low fees',
    native: true, // Native BlockRadar support
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    icon: 'Ξ',
    description: 'Via Circle Gateway',
    native: false,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    icon: '🔷',
    description: 'Via Circle Gateway',
    native: false,
  },
  {
    id: 'base',
    name: 'Base',
    icon: '🔵',
    description: 'Via Circle Gateway',
    native: false,
  },
  {
    id: 'polygon',
    name: 'Polygon',
    icon: '🟣',
    description: 'Via Circle Gateway',
    native: false,
  },
];

export function ReceiveDialog({
  open,
  onOpenChange,
  email,
  userId,
}: ReceiveDialogProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [selectedChain, setSelectedChain] = useState('solana');
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(false);

  // Fetch user's Solana address
  useEffect(() => {
    if (open && userId) {
      const fetchAddress = async () => {
        setLoadingAddress(true);
        try {
          const res = await fetch('/api/user/wallet');
          const data = await res.json();
          if (data.success && data.solanaAddress) {
            setSolanaAddress(data.solanaAddress);
          }
        } catch {
          console.error('Failed to fetch wallet address');
        }
        setLoadingAddress(false);
      };
      fetchAddress();
    }
  }, [open, userId]);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(true);
    toast.success('Email copied to clipboard!');
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleCopyAddress = () => {
    if (solanaAddress) {
      navigator.clipboard.writeText(solanaAddress);
      setCopiedAddress(true);
      toast.success('Address copied to clipboard!');
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const selectedChainInfo = SUPPORTED_CHAINS.find(
    (c) => c.id === selectedChain,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-accent" />
            Receive Money
          </DialogTitle>
          <DialogDescription>
            Choose how you want to receive funds
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="email" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Sendzz ID
            </TabsTrigger>
            <TabsTrigger value="usdc" className="flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              USDC Deposit
            </TabsTrigger>
          </TabsList>

          {/* Email/Sendzz ID Tab */}
          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="flex flex-col items-center justify-center py-4 space-y-4">
              {/* QR Code for Email */}
              <div className="p-3 bg-white rounded-2xl shadow-lg">
                <QRCodeSVG
                  value={`sendzz:${email}`}
                  size={120}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#4f46e5"
                />
              </div>

              <div className="text-center space-y-1">
                <h3 className="font-semibold">Your Sendzz ID</h3>
                <p className="text-sm text-muted-foreground">
                  Other users can send you money instantly
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
                    className="pr-12 font-medium text-center text-foreground"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 w-8 h-8 hover:bg-white/10"
                    onClick={handleCopyEmail}
                  >
                    {copiedEmail ? (
                      <Check className="w-4 h-4 text-accent" />
                    ) : (
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* USDC Deposit Tab */}
          <TabsContent value="usdc" className="space-y-4 mt-4">
            <div className="space-y-4">
              {/* Chain Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select Network</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SUPPORTED_CHAINS.map((chain) => (
                    <button
                      key={chain.id}
                      onClick={() => setSelectedChain(chain.id)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        selectedChain === chain.id
                          ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                          : 'border-white/10 bg-white/4 hover:border-white/20 hover:bg-white/8'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{chain.icon}</span>
                        <div>
                          <p className="font-medium text-sm text-foreground">
                            {chain.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {chain.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Deposit Address */}
              <div className="space-y-2">
                <Label>Deposit Address</Label>
                {loadingAddress ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : solanaAddress ? (
                  <div className="space-y-3">
                    {/* QR Code for Solana Address */}
                    <div className="flex justify-center">
                      <div className="p-3 bg-white border-2 border-green-100 rounded-2xl shadow-lg">
                        <QRCodeSVG
                          value={solanaAddress}
                          size={120}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#16a34a"
                        />
                      </div>
                    </div>

                    <div className="relative flex items-center">
                      <Input
                        value={solanaAddress}
                        readOnly
                        className="pr-12 font-mono text-xs text-foreground"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute right-1 w-8 h-8 hover:bg-white/10"
                        onClick={handleCopyAddress}
                      >
                        {copiedAddress ? (
                          <Check className="w-4 h-4 text-accent" />
                        ) : (
                          <Copy className="w-4 h-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>

                    {selectedChainInfo && !selectedChainInfo.native && (
                      <div className="p-3 bg-primary/8 rounded-lg border border-primary/20">
                        <p className="text-xs text-foreground/80">
                          <strong>Cross-chain deposit:</strong> Send USDC on{' '}
                          {selectedChainInfo.name} to this address. Circle
                          Gateway will automatically bridge it to Solana.
                        </p>
                      </div>
                    )}

                    <Button
                      className="w-full btn-shimmer text-white border-0 font-bold"
                      onClick={handleCopyAddress}
                    >
                      {copiedAddress ? (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="mr-2 h-4 w-4" />
                          Copy Address
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-6 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Wallet not set up yet
                    </p>
                    <Button
                      variant="outline"
                      className="border-white/10 bg-white/5 hover:bg-white/10 text-foreground"
                      onClick={() => toast.info('Wallet setup coming soon!')}
                    >
                      Set Up Wallet
                    </Button>
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className="p-3 rounded-lg border border-white/10 bg-white/4">
                <div className="flex items-start gap-2">
                  <ExternalLink className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground/80">
                      Only send USDC
                    </strong>{' '}
                    to this address. Sending other tokens may result in loss of
                    funds.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
