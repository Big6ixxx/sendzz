"use client";

import { ConnectedWallet } from "@privy-io/react-auth";
import { Send } from "lucide-react";
import { useTransfer } from "./transfer/useTransfer";
import { TransferForm } from "./transfer/TransferForm";
import { AddContactModal } from "./contacts/AddContactModal";
import { TransferSaveContactPrompt } from "./transfer/TransferSaveContactPrompt";

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
  } = useTransfer({
    smartAddress,
    embeddedProvider,
    balance,
    senderEmail,
    initialRecipientEmail,
    onClearInitialRecipient,
  });

  return (
    <div className="card-elegant p-8 md:p-12 bg-background border-border relative overflow-hidden">
      <div className="flex items-center gap-4 mb-10 border-b border-border/50 pb-6">
        <div className="p-3 bg-foreground text-background rounded-2xl shadow-lg">
          <Send className="w-6 h-6 md:w-8 md:h-8" />
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">
            Transfer
          </h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Send funds to anyone using their email address
          </p>
        </div>
      </div>

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
        lastCompletedTransfer={lastCompletedTransfer}
        recipientCheck={recipientCheck}
      />

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

      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-muted/20 rounded-full blur-3xl z-0" />
    </div>
  );
}
