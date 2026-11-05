import type { Metadata } from 'next';
import Link from 'next/link';
import { Blank, Bullets, Lead, LegalPage, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The rules for using Sendzz: what we do, what we ask of you, and what happens when something goes wrong.',
};

// Copy from the Terms of service frame in Figma. Payment partners and the USDC issuer are not
// named, per the product's rule against naming providers in what users read.
const sections: LegalSection[] = [
  {
    id: 'the-agreement',
    title: 'The agreement',
    body: (
      <>
        <p>
          Sendzz is run by <Blank>registered company name</Blank>, a company registered in <Blank>country of registration</Blank> at{' '}
          <Blank>registered address</Blank>. In these terms, &ldquo;Sendzz&rdquo;, &ldquo;we&rdquo; and &ldquo;us&rdquo; mean that
          company.
        </p>
        <p>
          These terms are the agreement between you and us. They apply whenever you use the Sendzz website or app. By creating an
          account or using Sendzz you agree to them. If you don’t agree, please don’t use Sendzz.
        </p>
        <p>
          Our{' '}
          <Link href="/privacy" className="font-semibold text-[var(--lp-ink)] underline underline-offset-2">
            privacy policy
          </Link>{' '}
          explains what we do with your personal information.
        </p>
      </>
    ),
  },
  {
    id: 'what-sendzz-is',
    title: 'What Sendzz is',
    body: (
      <>
        <p>
          Sendzz gives you an account that only you control, and the tools to hold, send and receive USDC with nothing more than an
          email address. USDC is a digital dollar issued by a regulated third party, not by us. Sendzz also connects you to payment
          partners who move money between USDC and local bank or mobile money accounts.
        </p>
        <p>
          Sendzz is self-custodial. When you sign in, a smart account is created for you and secured with passkeys and multi-party
          computation. We never store your private keys, we cannot freeze your account, and we cannot move your funds without your
          authorization.
        </p>
        <p>
          <Lead>Sendzz is not a bank.</Lead> Your balance is USDC that you hold yourself. It is not a bank deposit, it earns no
          interest from us, and it is not covered by any deposit insurance or compensation scheme.
        </p>
      </>
    ),
  },
  {
    id: 'who-can-use-sendzz',
    title: 'Who can use Sendzz',
    body: (
      <>
        <p>You can use Sendzz if all of these are true:</p>
        <Bullets
          items={[
            'You are at least 18 and legally able to enter into a contract.',
            'Using Sendzz is legal where you live.',
            'You are not on a sanctions list, not in a country under comprehensive sanctions, and not acting for anyone who is.',
            'You are using Sendzz for yourself, or for a business that has authorized you to act for it.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'your-account',
    title: 'Your account and your keys',
    body: (
      <>
        <p>
          You sign in with your email address and approve payments with a passkey: your face, your fingerprint or your device’s
          screen lock.
        </p>
        <p>
          Anyone who can get into your email and unlock your device can act as you. Keep both secure, and tell us straight away if
          you think someone else has access to your account.
        </p>
        <p>
          Because we never hold your keys, we may not be able to restore your access if you lose both your passkeys and your email
          account. You are responsible for everything done through your account, and for keeping the details you give us accurate.
        </p>
      </>
    ),
  },
  {
    id: 'sending-and-receiving',
    title: 'Sending and receiving',
    body: (
      <>
        <p>
          To send money you enter an email address and an amount, then approve the payment with your passkey. Check the address
          carefully before you approve.
        </p>
        <p>
          <Lead>Payments are final.</Lead> Once a payment is confirmed on the network, we cannot cancel, reverse or refund it. If it
          went to the wrong person, only that person can send it back.
        </p>
        <p>
          If the person you’re paying doesn’t have Sendzz yet, the payment is held in an escrow smart contract and they get an email
          with a claim link. Once they sign in with that email address, the money is theirs.{' '}
          <Blank>what happens to a payment that is never claimed, and after how long</Blank>
        </p>
        <p>
          The speeds we quote are typical, not guaranteed. Networks are sometimes slow or unavailable, and that is outside our
          control.
        </p>
      </>
    ),
  },
  {
    id: 'bank-deposits-and-withdrawals',
    title: 'Bank deposits and withdrawals',
    body: (
      <>
        <p>
          You can deposit NGN, KES or GHS from a bank or mobile money account and have it converted to USDC, and you can withdraw
          USDC to a local account. These conversions and payouts are carried out by independent payment partners, not by us.
        </p>
        <p>
          Before you confirm a deposit or withdrawal, we show you the exchange rate and the amount that will arrive. Rates move, so
          the one that counts is the one shown when you confirm. The calculator on our homepage uses mid-market reference rates and
          is only an illustration.
        </p>
        <p>
          Payouts usually land within minutes, but a payment partner, bank or mobile money operator can delay or reject one. If a
          withdrawal can’t be completed, the USDC is returned to your account.
        </p>
      </>
    ),
  },
  {
    id: 'identity-checks',
    title: 'Identity checks and limits',
    body: (
      <>
        <p>
          You can withdraw up to $100 before verifying your identity. To go higher, you complete an identity check.
        </p>
        <p>
          We and our payment partners may ask for more information at any time where the law requires it, and limits can change.
          Everything you give us must be true and must be yours. If we can’t verify you, we may limit or refuse bank deposits and
          withdrawals.
        </p>
      </>
    ),
  },
  {
    id: 'fees',
    title: 'Fees',
    body: (
      <>
        <Bullets
          items={[
            ['Sending and receiving USDC is free.', ' We pay the network fee on every transaction, so you never need another token to move your money.'],
            ['Bank deposits and withdrawals', ' are converted at the rate shown before you confirm. That rate includes the costs of the payment partners who carry out the conversion.'],
            ['Your own bank or mobile money operator', ' may charge you separately. We have no say over those charges.'],
          ]}
        />
        <p>
          If we ever introduce or change a fee, we will tell you before it applies. Any tax due on your use of Sendzz is yours to
          report and pay.
        </p>
      </>
    ),
  },
  {
    id: 'what-you-cant-do',
    title: 'What you can’t do',
    body: (
      <>
        <p>You agree not to use Sendzz to:</p>
        <Bullets
          items={[
            'break any law that applies to you or to the person you are paying;',
            'launder money, finance terrorism or get around sanctions;',
            'defraud anyone, or move money you have no right to move;',
            'pay for goods or services that are illegal where you or the recipient live;',
            'open an account with false details, or for someone else without their authority;',
            'get around our limits or identity checks;',
            'attack, overload or probe our systems, or interfere with anyone else’s use of Sendzz.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'suspending-and-closing',
    title: 'Suspending and closing',
    body: (
      <>
        <p>You can stop using Sendzz whenever you like.</p>
        <p>
          We may suspend or end your access to the Sendzz app, or to bank deposits and withdrawals, if you break these terms, if we
          suspect fraud or illegal activity, if the law, a regulator or a payment partner requires it, or if it is needed to keep
          Sendzz secure. We will tell you why unless the law stops us.
        </p>
        <p>
          That is about access to our service. It does not give us control of your funds, which stay in your account under your
          keys.
        </p>
      </>
    ),
  },
  {
    id: 'risks',
    title: 'Risks to understand',
    body: (
      <>
        <Bullets
          items={[
            ['USDC.', ' Its issuer sets the terms of USDC. We do not control it and cannot promise that it will always be worth one US dollar or always be redeemable. The issuer can block USDC at an address when the law requires it to.'],
            ['Networks and smart contracts.', ' Blockchains and the contracts that run on them can have bugs, congestion and outages. Transactions are public and cannot be undone.'],
            ['Changing rules.', ' The laws on digital assets are still developing. A change could limit or end what we can offer in your country.'],
          ]}
        />
        <p>Nothing on Sendzz is financial, legal or tax advice.</p>
      </>
    ),
  },
  {
    id: 'software-and-brand',
    title: 'Our software and brand',
    body: (
      <>
        <p>
          While you follow these terms, you may use the Sendzz app and website for your own payments. That right is personal to you
          and you can’t pass it on. The Sendzz name, logo and design belong to us.
        </p>
        <p>
          Our smart contracts are open source, and each is covered by its own license. If you send us feedback or ideas, we can use
          them without owing you anything.
        </p>
      </>
    ),
  },
  {
    id: 'our-responsibility',
    title: 'Our responsibility to you',
    body: (
      <>
        <p>
          We will run Sendzz with reasonable care and skill. We can’t promise it will always be available or free of errors, and
          beyond what these terms say it is provided as it is.
        </p>
        <p>As far as the law allows, we are not responsible for:</p>
        <Bullets
          items={[
            'things outside our reasonable control, such as network outages or the acts of a payment partner, a bank, a mobile money operator or the USDC issuer;',
            'losing access to your email or passkeys, or someone using access you gave them;',
            'payments you sent to the wrong address;',
            'lost profits, or losses that were not a foreseeable result of what we did.',
          ]}
        />
        <p>
          As far as the law allows, our total liability to you in any 12 months is limited to the fees you paid us in those 12
          months or US$100, whichever is greater.
        </p>
        <p>
          Nothing in these terms limits liability that cannot legally be limited, such as liability for fraud, or takes away rights
          you have as a consumer under the law where you live.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <>
        <p>
          We may update these terms as Sendzz and the law change. The date at the top of this page shows the latest version. If a
          change is significant, we will tell you by email or in the app before it takes effect.
        </p>
        <p>If you keep using Sendzz after a change takes effect, you accept the new terms.</p>
      </>
    ),
  },
  {
    id: 'law-and-disputes',
    title: 'Law and disputes',
    body: (
      <>
        <p>
          If something goes wrong, write to us first at <Blank>contact email</Blank>. Most problems are solved fastest that way.
        </p>
        <p>
          These terms are governed by the laws of <Blank>country of registration</Blank>, and its courts will decide any dispute,
          unless consumer law where you live gives you the right to use your own courts.
        </p>
        <p>
          If a court finds part of these terms unenforceable, the rest still applies. If we don’t enforce a term straight away, we
          can still enforce it later. You can’t transfer your rights under these terms without our agreement. We may transfer ours to
          a company that takes over Sendzz.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <>
        <p>
          Email <Blank>contact email</Blank>, or write to <Blank>registered company name</Blank>, <Blank>registered address</Blank>.
        </p>
        <p>We are also on X and Telegram.</p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of"
      italic="service."
      lead="The rules for using Sendzz: what we do, what we ask of you, and what happens when something goes wrong. We’ve kept them as plain as the law lets us."
      updated="3 October 2026"
      sections={sections}
      next={{ title: 'Privacy policy', body: 'What we collect about you, why we need it, and the choices you have.', href: '/privacy' }}
    />
  );
}
