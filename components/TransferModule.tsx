"use client";

import { useState } from "react";
import { ConnectedWallet } from "@privy-io/react-auth";
import { FlowTabs } from "./flow/ui";
import { useTransfer } from "./transfer/useTransfer";
import { TransferForm } from "./transfer/TransferForm";
import { AddContactModal } from "./contacts/AddContactModal";
import { TransferSaveContactPrompt } from "./transfer/TransferSaveContactPrompt";
import { TwoFactorModal, type VerificationMethod } from "./TwoFactorModal";
import { useCryptoTransfer } from "./transfer/useCryptoTransfer";
import { CryptoTransferForm } from "./transfer/CryptoTransferForm";
import { CrossChainSendModal } from "./transfer/CrossChainSendModal";
import { FirstTimeTransferWarningModal } from "./transfer/FirstTimeTransferWarningModal";
import { type ChainBalances, type SolanaSource } from "@/lib/web3/routing";

export function TransferModule({
  smartAddress,
  embeddedProvider,
  balance,
  chainBalances,
  solanaSource,
  senderEmail,
  initialRecipientEmail,
  onClearInitialRecipient,
  stellarAddress,
  stellarWalletId,
  stellarBalance,
  extra,
}: {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  balance: string;
  chainBalances?: ChainBalances;
  solanaSource?: SolanaSource;
  senderEmail: string;
  initialRecipientEmail?: string;
  onClearInitialRecipient?: () => void;
  stellarAddress?: string;
  stellarWalletId?: string;
  stellarBalance?: number;
  /** Cards shown under the send summary. */
  extra?: React.ReactNode;
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
    setTwoFaModalOpen: _setTwoFaModalOpen,
    twoFaLoading,
    twoFaError,
    handleTwoFaSubmit,
    handleTwoFaResend,
    totpEnabled,
    passkeyEnabled,
    warningModalOpen,
    setWarningModalOpen,
    handleWarningConfirm,
    handleTwoFaClose,
    activePlan,
    activeStep,
    sourcePref,
    setSourcePref,
    chainBalances: transferChainBalances,
    solanaBalance: transferSolanaBalance,
  } = useTransfer({
    smartAddress,
    embeddedProvider,
    balance,
    chainBalances,
    solanaSource,
    senderEmail,
    initialRecipientEmail,
    onClearInitialRecipient,
    stellarAddress,
    stellarWalletId,
    stellarBalance,
  });

  const cryptoTransfer = useCryptoTransfer({
    smartAddress,
    embeddedProvider,
    senderEmail,
    chainBalances,
    solanaSource,
  });

  const tabs = (
    <FlowTabs
      label="Send to"
      value={transferMode}
      onChange={setTransferMode}
      options={[
        { label: "To an email", value: "email" },
        { label: "To a wallet", value: "crypto" },
      ]}
    />
  );

  return (
    <>
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
          sourcePref={sourcePref}
          setSourcePref={setSourcePref}
          chainBalances={transferChainBalances}
          solanaBalance={transferSolanaBalance}
          activePlan={activePlan}
          activeStep={activeStep}
          tabs={tabs}
          extra={extra}
        />
      ) : (
        <CryptoTransferForm
          spendable={cryptoTransfer.spendable}
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
          stellarReady={cryptoTransfer.stellarReady}
          handleTransfer={cryptoTransfer.handleTransfer}
          sourcePref={cryptoTransfer.sourcePref}
          setSourcePref={cryptoTransfer.setSourcePref}
          chainBalances={cryptoTransfer.chainBalances}
          solanaBalance={cryptoTransfer.solanaBalance}
          tabs={tabs}
          extra={extra}
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
        onClose={handleTwoFaClose}
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

      <TwoFactorModal
        isOpen={cryptoTransfer.twoFaModalOpen}
        onClose={cryptoTransfer.handleTwoFaClose}
        onSubmit={cryptoTransfer.handleTwoFaSubmit}
        onResend={cryptoTransfer.handleTwoFaResend}
        loading={cryptoTransfer.twoFaLoading}
        error={cryptoTransfer.twoFaError}
        method={cryptoTransfer.totpEnabled ? "totp" : cryptoTransfer.passkeyEnabled ? "passkey" : "email"}
        availableMethods={(() => {
          const methods: VerificationMethod[] = ["email"];
          if (cryptoTransfer.totpEnabled) methods.push("totp");
          if (cryptoTransfer.passkeyEnabled) methods.push("passkey");
          return methods;
        })()}
        userEmail={senderEmail}
      />

      <FirstTimeTransferWarningModal
        isOpen={warningModalOpen}
        onClose={() => setWarningModalOpen(false)}
        onConfirm={handleWarningConfirm}
        recipientEmail={recipientEmail}
      />

      <CrossChainSendModal
        info={cryptoTransfer.bridgeConfirm}
        loading={cryptoTransfer.loading}
        onConfirm={cryptoTransfer.confirmBridgeSend}
        onClose={cryptoTransfer.cancelBridgeSend}
      />

    </>
  );
}
