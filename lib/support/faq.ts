/**
 * The support bot's entire knowledge.
 *
 * Deliberately a hand-written list rather than a model, and deliberately without a text box:
 * this answers questions about money that has already left someone's wallet, and a
 * plausible-sounding invention there is worse than no answer at all. Everything here is a claim
 * we can stand behind, and anything not covered goes to a human on Telegram instead.
 *
 * A curated list also tells people what we CAN help with. A blank input invites someone in a
 * panic to type a question we were never going to answer, then hands them a shrug.
 *
 * Adding an entry: keep `answer` short enough to read on a phone mid-problem, and make sure it
 * describes what the code actually does — these are support commitments, not marketing copy.
 */
export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export interface FaqSection {
  title: string;
  entries: FaqEntry[];
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    title: "Withdrawals",
    entries: [
      {
        id: "withdrawal-pending",
        question: "My withdrawal is still processing",
        answer:
          "Most withdrawals settle in well under two minutes, though banks are slower at night and at weekends. We only mark one complete once we have confirmed the money reached the account. So while it says processing, nothing has been lost. It simply has not landed yet, and it is worth giving it a little longer before worrying.",
      },
      {
        id: "withdrawal-failed",
        question: "My withdrawal failed, where is my money?",
        answer:
          "It depends on whether your transfer went out. If it never did, your USDC is still in your wallet and nothing was sent. If it did go out but the payout could not be made, we owe you that money back. Our team is alerted automatically and will return it to the wallet you sent from, including any fee you paid.",
      },
      {
        id: "how-long",
        question: "How long should a withdrawal take?",
        answer:
          "Under 90 seconds in the normal case. Your transfer confirms on chain, then we send the money to the bank. Bank transfers and mobile money are both close to instant in the countries we support. If it is taking longer, that is almost always the receiving bank or network congestion rather than the transfer itself.",
      },
      {
        id: "cancel",
        question: "Can I cancel a withdrawal?",
        answer:
          "Not once you have confirmed and sent the funds. The transfer is on a public blockchain and cannot be recalled. Before you send, you can back out at any step. If you have just sent to the wrong details, contact us on Telegram immediately, because the sooner we hear, the more options exist.",
      },
      {
        id: "insufficient-balance",
        question: "It says I don't have enough balance",
        answer:
          "Fees come out of your balance rather than being added on top, so the most you can withdraw is slightly less than your full balance. Tap MAX in the amount field and we will fill in the largest amount your balance covers, fees included.",
      },
      {
        id: "minimum",
        question: "Is there a minimum or maximum?",
        answer:
          "The minimum is 1 USDC equivalent. You can withdraw 100 USDC in total before you need to complete identity verification, whether that is one withdrawal or several small ones. If a limit affects you, the app says so before you confirm, not after.",
      },
    ],
  },
  {
    title: "Bank & payout details",
    entries: [
      {
        id: "wrong-bank-details",
        question: "I entered the wrong bank details",
        answer:
          "We verify the account name before a withdrawal is authorised, which catches most mistakes. If money has already gone to the wrong account it cannot simply be pulled back. Message us on Telegram straight away with the reference and we will try to recall it. That depends on the receiving bank, so it is not guaranteed, and speed matters.",
      },
      {
        id: "bank-not-listed",
        question: "My bank isn't in the list",
        answer:
          "The list is live, and only shows banks we can actually pay in your currency. If yours is missing, we cannot pay it yet. Tell us on Telegram which bank and country, because that is how we decide what to add next.",
      },
      {
        id: "name-mismatch",
        question: "The account name doesn't match mine",
        answer:
          "The name shown is what the bank has on file for that account number, not what you typed. If it looks wrong, check the account number digit by digit before continuing. A valid number belonging to someone else will verify perfectly well.",
      },
      {
        id: "mobile-money",
        question: "Can I withdraw to mobile money?",
        answer:
          "Yes, in the countries that support it. M-PESA and Airtel in Kenya, MTN and Vodafone in Ghana, MTN and Airtel in Uganda and Rwanda, Orange and Wave in West Africa, and others. Pick your currency and the available options appear. For mobile money we check the number's format and operator, but nobody can confirm the wallet's owner in advance, so please check the number twice.",
      },
    ],
  },
  {
    title: "Rates & fees",
    entries: [
      {
        id: "fees",
        question: "What fees do you charge?",
        answer:
          "We charge a fee on bridging between networks, on withdrawals to a bank, and on transfers sent on chain. Sending to someone by email is free. Every one of these is small, well below what you would normally pay elsewhere for the same thing. Whatever applies is shown in full before you confirm, on the 'Total Deducted' line, and nothing is taken after it.",
      },
      {
        id: "free-transfers",
        question: "Is sending to another Sendzz user free?",
        answer:
          "Yes. Sending by email costs nothing: no fee from us and no gas for you. You only pay when money moves onto a bank account, bridges between networks, or goes out on chain to an external wallet.",
      },
      {
        id: "exchange-rate",
        question: "How is my exchange rate decided?",
        answer:
          "The rate you see at confirmation is live, not an estimate. It is the rate your payout actually settles at. Rates move, so we hold it for a short window and refresh it automatically if it lapses before you confirm.",
      },
      {
        id: "rate-changed",
        question: "The amount changed before I confirmed",
        answer:
          "Rates move between the moment you type an amount and the moment you confirm. Rather than let you confirm a stale number, we refresh the quote and update the figure in front of you. What you see on the confirm screen is what pays out.",
      },
      {
        id: "supported-countries",
        question: "Which countries can I withdraw to?",
        answer:
          "Nigeria, Kenya, Ghana, Uganda, Tanzania, Rwanda, Cameroon, Gambia, the West African CFA countries and Brazil. The currencies shown in the withdrawal screen are the ones live for your account. If yours is not there, we do not support it yet.",
      },
    ],
  },
  {
    title: "Your wallet",
    entries: [
      {
        id: "who-controls-keys",
        question: "Who controls my wallet keys?",
        answer:
          "You do. Your wallet is created for you and secured against your login, and we never take custody of your funds. They sit in your wallet, not ours, and no one at Sendzz can move them. That is also why we can never restore access on your behalf, and why nobody from Sendzz will ever ask you for your recovery details.",
      },
      {
        id: "my-addresses",
        question: "What are my wallet addresses?",
        answer:
          "You have one address per network family: a single address shared across the EVM networks, one for Solana and one for Stellar. They are shown in the app under Deposit. They are not interchangeable, so always send to the address for the network you are actually sending on.",
      },
      {
        id: "which-networks",
        question: "Which networks do you support?",
        answer:
          "USDC on Base, Polygon, Ethereum, Arbitrum, Optimism, Avalanche, Solana and Stellar. You can hold balances on several at once and move between them inside the app, and withdrawals can settle from whichever network holds your funds.",
      },
      {
        id: "gas-sponsored",
        question: "Do I need gas to send?",
        answer:
          "No. We sponsor the gas on supported networks, so you do not need to hold ETH, SOL, XLM or any other native token just to move your USDC. You will see 'gasless transfer supported' before you confirm when it applies.",
      },
    ],
  },
  {
    title: "Deposits",
    entries: [
      {
        id: "deposit-not-showing",
        question: "My deposit hasn't shown up",
        answer:
          "Deposits appear once the transaction has enough confirmations on the network you sent from, usually a minute or two, and longer when a chain is busy. Check you sent USDC on a network we support and to the exact address shown. Funds sent on another network or to an old address may not be recoverable.",
      },
      {
        id: "wrong-network",
        question: "I sent to the wrong network",
        answer:
          "Contact us on Telegram with the transaction hash and the network you used. Recovery is sometimes possible and sometimes not, depending on the networks involved, but we cannot even look without the hash, so send it as soon as you can.",
      },
      {
        id: "split-balance",
        question: "My balance is split across networks",
        answer:
          "That is normal if you have deposited on more than one. A withdrawal settles on a single network, so if no one network holds enough, we move funds onto that network first. It is a real transfer on chain and takes a little time before the withdrawal continues.",
      },
      {
        id: "pending-claim",
        question: "What is a pending claim?",
        answer:
          "Moving USDC between networks happens in two halves: it leaves the first network, then it has to be collected on the second. Almost always both halves finish together. If the second one does not, the amount waits as a pending claim rather than being lost, and you finish it with one tap. You will find it on your dashboard and on the bridge screen.",
      },
      {
        id: "closed-tab-mid-move",
        question: "I closed the tab while my funds were moving",
        answer:
          "Nothing is lost. The move is recorded the moment it starts, so closing the tab, refreshing, losing signal or switching device does not affect it. Come back and open your dashboard: if anything still needs collecting it is waiting there as a pending claim. If it already completed on its own, nothing will be waiting and your balance is simply up to date.",
      },
      {
        id: "how-to-claim",
        question: "How do I claim funds that are waiting?",
        answer:
          "Open your dashboard or the bridge screen and look for Pending Claims. Tap Claim on the amount you want to collect and it lands in your wallet on the destination network. There is no deadline, so a claim can sit for days and still work, and it disappears from the list once the funds have arrived.",
      },
      {
        id: "claim-failed",
        question: "My claim did not work, can I try again?",
        answer:
          "Yes, as many times as you need. A claim that fails changes nothing: the amount stays waiting and stays yours. Failures are usually a busy network or a signature that was not completed, and trying again shortly afterwards normally works. If it keeps failing, message us on Telegram with the amount and the networks involved.",
      },
      {
        id: "withdrawal-needed-move",
        question: "My withdrawal said it was moving funds first",
        answer:
          "Your balance was on a different network from the one the withdrawal settles on, so we moved it across before paying out. You do not need to do anything and you are not charged extra for it. If the move does not finish, the withdrawal stops rather than continuing, and the amount waits as a pending claim you can collect.",
      },
    ],
  },
  {
    title: "Account & security",
    entries: [
      {
        id: "kyc",
        question: "Do I need to verify my identity?",
        answer:
          "Not straight away. You can withdraw 100 USDC in total without verifying, and it is yours to spend however you like: one withdrawal of 100, or five of 20. Once that total is reached we need you to complete a single identity check, which the regulations we operate under require. It normally takes a few minutes, and once it clears the limit no longer applies.",
      },
      {
        id: "kyc-how-long",
        question: "How long does verification take?",
        answer:
          "Usually a few minutes. You will need a government ID and a selfie. Once it is approved, it is done for good. You will not be asked again, and any withdrawal you were holding back can go straight through.",
      },
      {
        id: "install-app",
        question: "How do I install Sendzz on my phone?",
        answer:
          "Go to Settings and tap Install Sendzz. It adds Sendzz to your home screen so it opens full screen, without the browser bar, and can send you notifications when a withdrawal lands. On iPhone the button shows you the two taps to do it from Safari's Share menu, since Apple does not allow apps to install themselves. Nothing about your account or your funds changes either way, and you can keep using Sendzz in the browser if you prefer.",
      },
      {
        id: "2fa",
        question: "I can't complete 2FA",
        answer:
          "Larger withdrawals need two factor authentication. If your code is refused, check your device clock for authenticator codes, or request a fresh email code. You can change your 2FA method in Settings, and if you have lost access entirely, contact us on Telegram and we will verify you again.",
      },
      {
        id: "receipt",
        question: "How do I get a receipt?",
        answer:
          "Every completed withdrawal has one, with the full details including the transaction hash. Download it from the success screen right after a withdrawal, or any time afterwards from the transaction in your history. A copy is emailed to you as well.",
      },
      {
        id: "security",
        question: "Is my money safe?",
        answer:
          "Your funds sit in a wallet only you control, and we never take custody of them. Withdrawals require authentication and larger ones require 2FA. We will never ask for your recovery details, and nobody from Sendzz will ever message you first asking for them.",
      },
      {
        id: "session-expired",
        question: "It says my session expired",
        answer:
          "Your session timed out, usually after a long spell with the tab open. Refresh the page and sign in again. Nothing is lost, and any withdrawal already in progress carries on regardless of your browser.",
      },
    ],
  },
];
