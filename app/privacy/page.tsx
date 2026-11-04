import type { Metadata } from 'next';
import { Blank, Bullets, LegalPage, Sub, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Sendzz collects about you, why we need it, who sees it, and the choices you have.',
};

// Copy from the Privacy policy frame in Figma. Payment partners are not named, per the product's
// rule against naming providers in what users read.
const sections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: (
      <>
        <p>
          Sendzz is run by <Blank>registered company name</Blank>, a company registered in <Blank>country of registration</Blank> at{' '}
          <Blank>registered address</Blank>. We decide how your personal information is used, which makes us its &ldquo;data
          controller&rdquo;.
        </p>
        <p>
          This policy covers the Sendzz website and app. If anything in it is unclear, write to <Blank>contact email</Blank>.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    body: (
      <>
        <Sub>What you give us</Sub>
        <Bullets
          items={[
            ['Your email address', ', which you use to sign in and to receive payments.'],
            ['Your passkey’s public key.', ' Your face or fingerprint never leaves your device. We only receive proof that you approved something.'],
            ['Identity details', ', if you verify your identity: such as your name, date of birth, a government-issued ID and a photo of your face.'],
            ['Bank or mobile money details', ' for deposits and withdrawals: the account name, the account number and the bank or operator.'],
            ['The people you pay', ': their email addresses, and their account details if you withdraw to them.'],
            ['Messages', ' you send to our support team.'],
          ]}
        />
        <Sub>What we record as you use Sendzz</Sub>
        <Bullets
          items={[
            ['Payments', ': amounts, dates, who was paid, whether it arrived, and your account’s address on the network.'],
            ['Device and log data', ': your IP address, browser and device type, the screens you use and any errors you run into.'],
          ]}
        />
        <Sub>What we get from others</Sub>
        <Bullets
          items={[
            'The result of your identity check, from the provider that runs it.',
            'The status of deposits and withdrawals, from our payment partners.',
            'Transaction records, from the public blockchain.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'if-someone-sends-you-money',
    title: 'If someone sends you money',
    body: (
      <p>
        You don’t need a Sendzz account to be paid through Sendzz. When someone sends money to your email address, they give us
        that address. We use it to tell you about the payment and to make sure only you can claim it.
      </p>
    ),
  },
  {
    id: 'how-we-use-it',
    title: 'How we use it',
    body: (
      <>
        <p>We use your information only where the law gives us a reason to:</p>
        <Bullets
          items={[
            ['To do what we agreed with you', ': run your account, carry out your payments, and send you receipts, claim links and notices about the service.'],
            ['To meet our legal duties', ': verify who you are, prevent fraud and money laundering, and keep the records the law requires.'],
            ['For our legitimate interests', ': keep Sendzz secure, fix what breaks, and understand how it is used so we can improve it.'],
            ['With your consent', ': send you news and offers. You can unsubscribe at any time.'],
          ]}
        />
        <p>We do not sell your personal information.</p>
      </>
    ),
  },
  {
    id: 'who-we-share-it-with',
    title: 'Who we share it with',
    body: (
      <>
        <Bullets
          items={[
            ['Identity verification providers', ', to check your documents.'],
            ['Payment partners', ', and the banks and mobile money operators that complete your deposits and withdrawals.'],
            ['Service providers', ' that host Sendzz, secure your account, deliver our emails and run our support tools.'],
            ['Regulators, courts and law enforcement', ', when the law requires it.'],
            ['A company that takes over Sendzz', ', if we merge or are sold.'],
          ]}
        />
        <p>Each of them gets only what it needs for its job, and may not use it for anything else.</p>
      </>
    ),
  },
  {
    id: 'public-on-the-blockchain',
    title: 'What is public on the blockchain',
    body: (
      <>
        <p>
          Payments made with Sendzz are recorded on public blockchains. Account addresses, amounts and times are visible to anyone
          and stay there permanently. We cannot edit or delete them.
        </p>
        <p>
          Those records are tied to account addresses, not to names. But anyone who learns which address is yours can see its
          history.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and this website',
    body: (
      <>
        <p>
          This website does not use advertising or analytics cookies. Its fonts are served by Sendzz itself. It loads its
          reference exchange rates from ExchangeRate-API and, as with any request on the web, that service receives your IP
          address.
        </p>
        <p>
          The Sendzz app stores a small amount of data on your device to keep you signed in and remember your settings. The app
          can’t work without it.
        </p>
      </>
    ),
  },
  {
    id: 'where-it-goes',
    title: 'Where your information goes',
    body: (
      <p>
        We and the companies we work with operate in more than one country, so your information may be handled outside the
        country you live in. When we send it abroad, we put in place the safeguards the law requires, such as contracts that hold
        the recipient to the same standard of protection.
      </p>
    ),
  },
  {
    id: 'how-long',
    title: 'How long we keep it',
    body: (
      <>
        <p>
          We keep your account information for as long as your account is open. After that, we keep identity and payment records
          for as long as the laws on money laundering and tax require, and then delete them or make them anonymous.
        </p>
        <p>Records on the blockchain are permanent and outside our control.</p>
      </>
    ),
  },
  {
    id: 'how-we-protect-it',
    title: 'How we protect it',
    body: (
      <>
        <p>
          Your information is encrypted when it travels and when it is stored, and only the people who need it for their work can
          see it. We never hold your private keys or your biometrics.
        </p>
        <p>No system is perfectly secure. If a breach puts you at risk, we will tell you, and the regulator, as the law requires.</p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: (
      <>
        <p>Depending on where you live, you can ask us to:</p>
        <Bullets
          items={[
            'give you a copy of the information we hold about you;',
            'correct anything that is wrong;',
            'delete your information, or stop or limit how we use it;',
            'hand your information to you or to another provider in a usable format;',
            'stop relying on a consent you gave us.',
          ]}
        />
        <p>
          To use any of these rights, write to <Blank>contact email</Blank>. We will answer within the time your local law sets. We
          cannot delete what the law requires us to keep, or anything on the blockchain.
        </p>
        <p>
          You can also complain to the data protection authority where you live: for example the Nigeria Data Protection
          Commission, the Office of the Data Protection Commissioner in Kenya, or the Data Protection Commission in Ghana.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        Sendzz is for adults. We do not knowingly collect information from anyone under 18. If you believe a child has given us
        theirs, tell us and we will delete it.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We may update this policy as Sendzz and the law change. The date at the top of this page shows the latest version. If a
        change is significant, we will tell you by email or in the app before it takes effect.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Email <Blank>contact email</Blank>, or write to <Blank>registered company name</Blank>, <Blank>registered address</Blank>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      italic="policy."
      lead="What we collect about you, why we need it, who sees it, and the choices you have. Sendzz never holds your keys. This page is about the information we do hold."
      updated="3 October 2026"
      sections={sections}
      next={{ title: 'Terms of service', body: 'What you can expect from Sendzz, and what we expect from you.', href: '/terms' }}
    />
  );
}
