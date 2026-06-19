"use client";

import { useState } from "react";
import { ConnectedWallet } from "@privy-io/react-auth";
import { Send, Wallet } from "lucide-react";
import { useTransfer } from "./transfer/useTransfer";
import { TransferForm } from "./transfer/TransferForm";
import { AddContactModal } from "./contacts/AddContactModal";
import { TransferSaveContactPrompt } from "./transfer/TransferSaveContactPrompt";
import { TwoFactorModal, type VerificationMethod } from "./TwoFactorModal";
import { useCryptoTransfer } from "./transfer/useCryptoTransfer";
import { CryptoTransferForm } from "./transfer/CryptoTransferForm";

export function TransferModule({
  smartAddress,
  embeddedProvider,
  balance,
  senderEmail,
  initialRecipientEmail,
  onClearInitialRecipient,
}: {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  balance: string;
  senderEmail: string;
  initialRecipientEmail?: string;
  onClearInitialRecipient?: () => void;
}) {
  const [transferMode, setTransferMode] = useState<"email" | "crypto">("email");

  const {
    recipientEmail,
    setRecipientEmail,
    amount,
    setAmount,
    currency,
    setCurrency,
    memo,
    setMemo,
    loading,
    status,
    showSuggestions,
    setShowSuggestions,
    isAddingContact,
    setIsAddingContact,
    showSavePrompt,
    setShowSavePrompt,
    lastRecipient,
    lastCompletedTransfer,
    contacts,
    amountUsdc,
    isFiat,
    exchangeRate,
    isOverBalance,
    isZeroBalance,
    handleTransfer,
    recipientCheck,
    twoFaModalOpen,
    setTwoFaModalOpen,
    twoFaLoading,
    twoFaError,
    handleTwoFaSubmit,
    handleTwoFaResend,
    totpEnabled,
    passkeyEnabled,
  } = useTransfer({
    smartAddress,
    embeddedProvider,
    balance,
    senderEmail,
    initialRecipientEmail,
    onClearInitialRecipient,
  });

  const cryptoTransfer = useCryptoTransfer({
    smartAddress,
    embeddedProvider,
    senderEmail,
  });

  return (
    <div className="card-elegant p-8 md:p-12 bg-background border-border relative overflow-hidden">
      <div className="flex items-center gap-4 mb-8 border-b border-border/50 pb-6">
        <div className="p-3 bg-foreground text-background rounded-2xl shadow-lg">
          {transferMode === 'email' ? <Send className="w-6 h-6 md:w-8 md:h-8" /> : <Wallet className="w-6 h-6 md:w-8 md:h-8" />}
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">
            Transfer
          </h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {transferMode === 'email' ? 'Send funds using an email address' : 'Send crypto to an external wallet'}
          </p>
        </div>
      </div>

      <div className="flex bg-muted/50 p-1 rounded-2xl mb-8 relative z-20 w-full">
        <button
          type="button"
          onClick={() => setTransferMode('email')}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl transition-all duration-300 ${
            transferMode === 'email'
              ? 'bg-background shadow-md text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Email
        </button>
        <button
          type="button"
          onClick={() => setTransferMode('crypto')}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl transition-all duration-300 ${
            transferMode === 'crypto'
              ? 'bg-background shadow-md text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          External Wallet
        </button>
      </div>

      {transferMode === "email" ? (
        <TransferForm
          recipientEmail={recipientEmail}
          setRecipientEmail={setRecipientEmail}
          amount={amount}
          setAmount={setAmount}
          currency={currency}
          setCurrency={setCurrency}
          memo={memo}
          setMemo={setMemo}
          loading={loading}
          status={status}
          showSuggestions={showSuggestions}
          setShowSuggestions={setShowSuggestions}
          setIsAddingContact={setIsAddingContact}
          contacts={contacts}
          amountUsdc={amountUsdc}
          isFiat={isFiat}
          exchangeRate={exchangeRate}
          isOverBalance={isOverBalance}
          isZeroBalance={isZeroBalance}
          handleTransfer={handleTransfer}
          smartAddress={smartAddress}
          balance={balance}
          lastCompletedTransfer={lastCompletedTransfer}
          recipientCheck={recipientCheck}
        />
      ) : (
        <CryptoTransferForm
          recipientAddress={cryptoTransfer.recipientAddress}
          setRecipientAddress={cryptoTransfer.setRecipientAddress}
          amount={cryptoTransfer.amount}
          setAmount={cryptoTransfer.setAmount}
          selectedChain={cryptoTransfer.selectedChain}
          setSelectedChain={cryptoTransfer.setSelectedChain}
          memo={cryptoTransfer.memo}
          setMemo={cryptoTransfer.setMemo}
          loading={cryptoTransfer.loading}
          status={cryptoTransfer.status}
          balance={cryptoTransfer.balance}
          isFetchingBalance={cryptoTransfer.isFetchingBalance}
          isOverBalance={cryptoTransfer.isOverBalance}
          isZeroBalance={cryptoTransfer.isZeroBalance}
          isSettingUpStellar={cryptoTransfer.isSettingUpStellar}
          handleTransfer={cryptoTransfer.handleTransfer}
        />
      )}

      <AddContactModal
        isOpen={isAddingContact}
        onClose={() => setIsAddingContact(false)}
        senderEmail={senderEmail}
        defaultEmail={recipientEmail}
      />

      <TransferSaveContactPrompt
        isOpen={showSavePrompt}
        onClose={() => setShowSavePrompt(false)}
        senderEmail={senderEmail}
        recipientEmail={lastRecipient}
      />

      <TwoFactorModal
        isOpen={twoFaModalOpen}
        onClose={() => setTwoFaModalOpen(false)}
        onSubmit={handleTwoFaSubmit}
        onResend={handleTwoFaResend}
        loading={twoFaLoading}
        error={twoFaError}
        method={totpEnabled ? "totp" : passkeyEnabled ? "passkey" : "email"}
        availableMethods={(() => {
          const methods: VerificationMethod[] = ["email"];
          if (totpEnabled) methods.push("totp");
          if (passkeyEnabled) methods.push("passkey");
          return methods;
        })()}
        userEmail={senderEmail}
      />

      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-muted/20 rounded-full blur-3xl z-0 pointer-events-none" />
    </div>
  );
}
