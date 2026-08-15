/**
 * Email Templates
 *
 * Modern, responsive email templates for Sendzz.
 * Using inline styles and robust table layouts for maximum compatibility.
 */
import { explorerTxUrl, HOME_CHAIN, isPlaceholderHash, shortenHash } from '@/lib/explorers';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

/**
 * Base email wrapper template
 */
function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sendzz</title>
  <style>
    /* Geist Font Import */
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/Geist-Bold.woff2') format('woff2');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/Geist-Black.woff2') format('woff2');
      font-weight: 900;
      font-style: normal;
    }
    
    body, table, td, p, a, div, h1, h2, h3 {
      font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100% !important; background-color: #F2FBF1; font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="width: 100%; background-color: #F2FBF1; padding: 40px 0;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 584px; margin: 0 auto; background-color: #F2FBF1;">
      <!-- Header -->
      <tr>
        <td align="center" style="background-color: #0E2406; border-radius: 24px 24px 0 0; padding: 60px 20px; background-image: url('${APP_URL}/headerBg.svg'); background-repeat: no-repeat; background-position: center;">
          <img src="${APP_URL}/logo.svg" alt="Sendzz" width="180" style="display: block;">
        </td>
      </tr>
      
      <!-- Main Content Card -->
      <tr>
        <td style="background-color: #ffffff; padding: 40px 20px;">
          ${content}
        </td>
      </tr>
      
      <!-- Coil Divider -->
      <tr>
        <td style="padding: 0; line-height: 0; font-size: 0; background-color: #ffffff;">
          <img src="${APP_URL}/coil.svg" width="584" style="width: 100%; max-width: 100%; height: auto; display: block; border: 0;" alt="">
        </td>
      </tr>
      
      <!-- Footer Illustration with Positioned Text -->
      <tr>
        <td align="center" style="padding: 40px 20px; color: #006633;">
          <p style="margin: 0 0 4px 0; font-size: 16px; line-height: 1.6; font-weight: 500;">Its secured to your email and ready for your bank.</p>
          <p style="margin: 0 0 4px 0; font-size: 16px; line-height: 1.6; font-weight: 500;">No codes or waiting</p>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; font-weight: 500;">Click above to get your money now</p>
          
          <!-- ILLUSTRATION PRESERVED AS REQUESTED (COMMENTED OUT) -->
          <div style="margin-top: 40px; position: relative; width: 100%; max-width: 450px;">
            <img src="${APP_URL}/Group%20275.svg" alt="Illustration" width="450" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
          </div>
          
          <p style="font-size: 12px; color: #94a3b8; margin-top: 60px;">
            Sendzz • Fast & Borderless Payments
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
  `.trim();
}

/**
 * OTP Login Email Template
 */
export function otpLoginTemplate(code: string): string {
  const digits = code.split('');
  const digitBoxes = digits.map(d => `
    <td style="padding: 0 4px;">
      <div style="width: 44px; height: 52px; border: 1.5px solid #006633; border-radius: 14px; font-size: 26px; font-weight: 700; color: #252525; text-align: center; line-height: 52px; font-family: 'Geist', sans-serif; background-color: #ffffff;">
        ${d}
      </div>
    </td>
  `).join('');

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 15px; color: #555555; margin: 0 0 8px 0;">Hi there, please confirm your sign in</p>
      <h1 style="font-size: 34px; font-weight: 950; color: #111111; margin: 0 0 6px 0; letter-spacing: -1px;">Sign In to Sendzz</h1>
      <p style="font-size: 14px; color: #888888; margin: 0 0 32px 0;">One-time authorization code</p>

      <div style="text-align: left; margin: 0 0 28px 0;">
        <p style="font-size: 15px; font-weight: 700; color: #111111; margin: 0 0 4px 0;">Your one-time code</p>
        <p style="font-size: 14px; color: #555555; margin: 0;">Enter this <strong>6-digit code</strong> in the Sendzz webapp to sign in. The code expires in <strong>10 minutes</strong>.</p>
      </div>

      <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 32px auto;">
        <tr>${digitBoxes}</tr>
      </table>

      <p style="font-size: 12px; color: #aaaaaa; margin: 20px 0 0 0;">If you didn't request this code, you can safely ignore this email.</p>
    </div>
  `);
}

/**
 * Unified Transaction OTP Template
 * Used for all 2FA-gated actions: transfers, withdrawals, on-chain sends.
 */
export function transactionOTPTemplate(
  code: string,
  actionType: 'transfer' | 'withdrawal',
  details: {
    amount: string;
    /** Can be an email, a wallet address (0x... or G...), or "batch" */
    recipientEmail?: string;
    fiatCurrency?: string;
    fiatAmount?: string;
    note?: string;
  }
): string {
  const digits = code.split('');
  const digitBoxes = digits.map(d => `
    <td style="padding: 0 4px;">
      <div style="width: 44px; height: 52px; border: 1.5px solid #006633; border-radius: 14px; font-size: 26px; font-weight: 700; color: #252525; text-align: center; line-height: 52px; font-family: 'Geist', sans-serif; background-color: #ffffff;">
        ${d}
      </div>
    </td>
  `).join('');

  // --- Detect recipient type ---
  const rec = details.recipientEmail || '';
  const isWalletAddress = rec.startsWith('0x') || /^[GC][A-Z0-9]{54,}$/.test(rec);
  const isBatch = rec === 'batch';
  const isEmail = !isWalletAddress && !isBatch && rec.includes('@');

  let actionLabel: string;
  let amountDisplay: string;
  let contextLine: string;
  let ctaLabel: string;
  let subjectText: string;

  if (actionType === 'transfer') {
    amountDisplay = `${details.amount} USDC`;

    if (isBatch) {
      actionLabel = 'confirm your batch transfer of';
      contextLine = 'to <strong>multiple recipients</strong>';
      ctaLabel = 'Verify Batch Transfer';
      subjectText = `Confirm your batch transfer of ${details.amount} USDC`;
    } else if (isWalletAddress) {
      // Truncate wallet for display: first 6 + ... + last 4
      const shortAddr = `${rec.slice(0, 6)}...${rec.slice(-4)}`;
      actionLabel = 'confirm your on-chain transfer of';
      contextLine = `to wallet <strong style="font-family:'Courier New',monospace; font-size:13px;">${shortAddr}</strong>`;
      ctaLabel = 'Verify Transfer';
      subjectText = `Confirm your on-chain transfer of ${details.amount} USDC`;
    } else {
      // Email transfer
      actionLabel = 'confirm your transfer of';
      contextLine = rec ? `to <strong>${rec}</strong>` : 'to recipient';
      ctaLabel = 'Verify Transfer';
      subjectText = rec
        ? `Confirm your transfer of ${details.amount} USDC to ${rec}`
        : `Confirm your transfer of ${details.amount} USDC`;
    }
  } else {
    actionLabel = 'confirm your withdrawal of';
    amountDisplay = `${details.amount} USDC`;
    contextLine = details.fiatCurrency && details.fiatAmount
      ? `converted to <strong>${details.fiatAmount} ${details.fiatCurrency}</strong>`
      : `converted to <strong>${details.fiatCurrency || 'local currency'}</strong>`;
    ctaLabel = 'Verify Withdrawal';
    subjectText = `Confirm your withdrawal of ${details.amount} USDC`;
  }

  void isEmail;
  void ctaLabel;
  void subjectText;

  const noteSection = details.note
    ? `<p style="font-size:13px; color:#888888; font-style:italic; margin: 0 0 20px 0;">"${details.note}"</p>`
    : '';

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 15px; color: #555555; margin: 0 0 8px 0;">Hi there, please ${actionLabel}</p>
      <h1 style="font-size: 38px; font-weight: 950; color: #111111; margin: 0 0 6px 0; letter-spacing: -1.5px;">$${amountDisplay}</h1>
      <p style="font-size: 14px; color: #555555; margin: 0 0 ${details.note ? '8px' : '32px'} 0;">${contextLine}</p>
      ${noteSection}

      <div style="text-align: left; margin: 0 0 20px 0;">
        <p style="font-size: 15px; font-weight: 700; color: #111111; margin: 0 0 4px 0;">Your one-time code</p>
        <p style="font-size: 14px; color: #555555; margin: 0;">Enter this <strong>6-digit code</strong> in the Sendzz webapp to authorize the ${actionType === 'transfer' ? 'transfer' : 'withdrawal'}. The code expires in <strong>10 minutes</strong>.</p>
      </div>

      <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 32px auto;">
        <tr>${digitBoxes}</tr>
      </table>

      <p style="font-size: 12px; color: #aaaaaa; margin: 20px 0 0 0;">
        If you did not initiate this transaction, please ignore this email and contact support immediately.
      </p>
    </div>
  `);
}

/** Helper to derive a dynamic email subject from OTP details — used by twoFactor.ts */
export function otpEmailSubject(
  actionType: 'transfer' | 'withdrawal',
  details: { amount: string; recipientEmail?: string; fiatCurrency?: string; }
): string {
  const rec = details.recipientEmail || '';
  const isWallet = rec.startsWith('0x') || /^[GC][A-Z0-9]{54,}$/.test(rec);
  const isBatch = rec === 'batch';

  if (actionType === 'withdrawal') {
    return `Confirm your withdrawal of ${details.amount} USDC`;
  }
  if (isBatch) return `Confirm your batch transfer of ${details.amount} USDC`;
  if (isWallet) return `Confirm your on-chain transfer of ${details.amount} USDC`;
  return rec ? `Confirm your transfer of ${details.amount} USDC to ${rec}` : `Confirm your transfer of ${details.amount} USDC`;
}


/**
 * @deprecated Use transactionOTPTemplate instead
 */
export function withdrawalOTPTemplate(
  code: string,
  amount: string,
  currency: string,
): string {
  return transactionOTPTemplate(code, 'withdrawal', { amount, fiatCurrency: currency });
}


/**
 * Claim Transfer Email Template
 */
export function claimTransferTemplate(
  amount: string,
  senderEmail: string,
  claimUrl: string,
  note?: string,
): string {
  const noteSection = note
    ? `<p style="font-style: italic; color: #64748b; margin-bottom: 24px;">"${note}"</p>`
    : '';

  const displayAmount = amount.startsWith('$') ? amount : `$${amount}`;

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 32px 0;">
        Hi there, <a href="mailto:${senderEmail}" style="color: #006633; font-weight: 700; text-decoration: underline;">${senderEmail}</a> just sent you <strong>${displayAmount}</strong> using <span style="color: #1F5E12; font-weight: 900;">Sendzz</span>
      </p>
      
      <div style="font-size: 48px; font-weight: 900; color: #1F5E12; margin: 0 0 40px 0; letter-spacing: -1px;">${displayAmount} USDC</div>
      
      <div style="max-width: 440px; margin: 0 auto; text-align: left;">
        <h2 style="font-size: 18px; font-weight: 800; color: #111111; margin: 0 0 10px 0;">What's next?</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 20px 0;">Once you click the link and log in with your email, you can:</p>
        
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Transfer to your bank:</strong> Send the funds directly to your local bank account.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Keep it in your Sendzz account:</strong> Save it for later or use it to pay someone else.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Send it to a friend:</strong> All you need is their email address to pass the money along.</td>
          </tr>
        </table>
      </div>

      ${noteSection}

      <div style="margin-top: 32px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td><img src="${APP_URL}/Group%20248.png" width="44" style="display: block; opacity: 0.9; margin-right: 14px;"></td>
            <td><a href="${claimUrl}" style="display: inline-block; background-color: #67ED0A; color: #004421 !important; padding: 14px 36px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 18px;">Access My Funds</a></td>
            <td><img src="${APP_URL}/Group%20248.png" width="44" style="display: block; opacity: 0.9; margin-left: 14px;"></td>
          </tr>
        </table>
      </div>
    </div>
  `);
}

/**
 * Transfer Received (Instant) Template
 */
export function transferReceivedTemplate(
  amount: string,
  senderEmail: string,
  note?: string,
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || 'https://sendzz.io',
  actionUrl?: string,
): string {
  const noteSection = note
    ? `<div style="background-color: #F8FAFC; border-radius: 12px; padding: 16px; margin: 24px auto 0 auto; max-width: 440px; text-align: left; font-style: italic; color: #475569; font-size: 14px; border: 1px solid #E2E8F0;">"${note}"</div>`
    : '';

  const targetUrl = actionUrl || `${appUrl}/dashboard`;
  const displayAmount = amount.startsWith('$') ? amount : `$${amount}`;

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 32px 0;">
        Hi there, <a href="mailto:${senderEmail}" style="color: #006633; font-weight: 700; text-decoration: underline;">${senderEmail}</a> just sent you <strong>${displayAmount}</strong> using <span style="color: #1F5E12; font-weight: 900;">Sendzz</span>
      </p>
      
      <div style="font-size: 48px; font-weight: 900; color: #1F5E12; margin: 0 0 40px 0; letter-spacing: -1px;">${displayAmount} USDC</div>
      
      <div style="max-width: 440px; margin: 0 auto; text-align: left;">
        <h2 style="font-size: 18px; font-weight: 800; color: #111111; margin: 0 0 10px 0;">What's next?</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 20px 0;">Once you click the link and log in with your email, you can:</p>
        
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Transfer to your bank:</strong> Send the funds directly to your local bank account.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Keep it in your Sendzz account:</strong> Save it for later or use it to pay someone else.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Send it to a friend:</strong> All you need is their email address to pass the money along.</td>
          </tr>
        </table>
      </div>

      ${noteSection}

      <div style="margin-top: 32px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td><img src="${APP_URL}/Group%20248.png" width="44" style="display: block; opacity: 0.9; margin-right: 14px;"></td>
            <td><a href="${targetUrl}" style="display: inline-block; background-color: #67ED0A; color: #004421 !important; padding: 14px 36px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 18px;">Access My Funds</a></td>
            <td><img src="${APP_URL}/Group%20248.png" width="44" style="display: block; opacity: 0.9; margin-left: 14px;"></td>
          </tr>
        </table>
      </div>
    </div>
  `);
}

/**
 * Shared receipt card template for CONFIRMED ledger actions.
 * Plugs into baseTemplate wrapper.
 */
interface ReceiptRow {
  label: string;
  value: string;
  isMonospace?: boolean;
  /** Renders the value as a link — used for on-chain hashes so they reach an explorer. */
  href?: string | null;
}

function baseReceiptTemplate(
  amountUsdc: string,
  rows: ReceiptRow[]
): string {
  const cleanAmount = parseFloat(amountUsdc);
  const formattedAmount = isNaN(cleanAmount) ? amountUsdc : cleanAmount.toFixed(2);
  const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  
  const tableRows = rows.map(row => {
    // Underlined + brand-coloured so it reads as tappable in clients that strip CSS.
    const value = row.href
      ? `<a href="${row.href}" target="_blank" rel="noopener noreferrer" style="color: #006633 !important; text-decoration: underline;">${row.value}</a>`
      : row.value;

    return `
    <tr>
      <td style="padding: 14px 0; font-size: 11px; font-weight: 700; color: #707070; text-transform: uppercase; border-bottom: 1px dashed #E2E8E0;">${row.label}</td>
      <td style="padding: 14px 0; text-align: right; font-size: 13px; font-weight: 700; color: #111111; border-bottom: 1px dashed #E2E8E0; ${row.isMonospace ? "font-family: 'Courier New', Courier, monospace;" : ""}">
        ${value}
      </td>
    </tr>
  `;
  }).join('');

  return baseTemplate(`
    <div>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="left" valign="middle">
            <img src="${APP_URL}/logo-black.svg" alt="Sendzz" width="90" style="display: block;">
          </td>
          <td align="right" valign="middle">
            <span style="background-color: #006633; color: #ffffff !important; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">CONFIRMED</span>
          </td>
        </tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <h1 style="font-size: 38px; font-weight: 950; color: #006633; margin: 0; letter-spacing: -1.5px;">$${formattedAmount} USDC</h1>
        <p style="font-size: 13px; color: #707070; margin: 6px 0 0 0;">on ${dateStr}</p>
      </div>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 16px; margin-bottom: 8px;">
        ${tableRows}
      </table>
    </div>
  `);
}

/**
 * Withdrawal Completed Template
 */
export function withdrawalCompletedTemplate(
  amountUsdc: string,
  fiatAmount: string,
  currency: string,
  bankMasked: string,
  referenceId?: string,
  orderId?: string
): string {
  const ref = referenceId || Math.random().toString(36).substring(2, 10).toUpperCase();
  const ord = orderId || ref;
  const cleanAmt = parseFloat(amountUsdc) || 0;
  const cleanFiat = parseFloat(fiatAmount) || 0;
  const rate = cleanAmt > 0 ? (cleanFiat / cleanAmt).toFixed(2) : '1,392.61';

  return baseReceiptTemplate(amountUsdc, [
    { label: 'Reference ID', value: ref, isMonospace: true },
    { label: 'Transaction Receipt', value: `#${ref.substring(0, 8)}`, isMonospace: true },
    { label: 'Fiat Amount', value: `${cleanFiat.toLocaleString()} ${currency}` },
    { label: 'Exchange Rate', value: `1 USDC = ${rate} ${currency}` },
    { label: 'Sent To', value: bankMasked },
    { label: 'Order ID', value: ord, isMonospace: true }
  ]);
}

/**
 * Deposit Confirmed Template
 */
export function depositConfirmedTemplate(
  amountUsdc: string,
  userEmail?: string,
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || 'https://sendzz.io',
): string {
  const displayAmount = amountUsdc.startsWith('$') ? amountUsdc : `$${amountUsdc}`;
  const targetUrl = userEmail
    ? `${appUrl}/?email=${encodeURIComponent(userEmail)}`
    : `${appUrl}/dashboard`;

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 32px 0;">
        Hi there, a deposit of <strong>${displayAmount}</strong> has arrived in your <span style="color: #1F5E12; font-weight: 900;">Sendzz</span> account
      </p>
      
      <div style="font-size: 48px; font-weight: 900; color: #1F5E12; margin: 0 0 40px 0; letter-spacing: -1px;">${displayAmount} USDC</div>
      
      <div style="max-width: 440px; margin: 0 auto; text-align: left;">
        <h2 style="font-size: 18px; font-weight: 800; color: #111111; margin: 0 0 10px 0;">What's next?</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 20px 0;">Once you click the link and log in with your email, you can:</p>
        
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Transfer to your bank:</strong> Send the funds directly to your local bank account.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Keep it in your Sendzz account:</strong> Save it for later or use it to pay someone else.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;"><strong>Send it to a friend:</strong> All you need is their email address to pass the money along.</td>
          </tr>
        </table>
      </div>

      <div style="margin-top: 32px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td><img src="${APP_URL}/Group%20248.png" width="44" style="display: block; opacity: 0.9; margin-right: 14px;"></td>
            <td><a href="${targetUrl}" style="display: inline-block; background-color: #67ED0A; color: #004421 !important; padding: 14px 36px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 18px;">Access My Funds</a></td>
            <td><img src="${APP_URL}/Group%20248.png" width="44" style="display: block; opacity: 0.9; margin-left: 14px;"></td>
          </tr>
        </table>
      </div>
    </div>
  `);
}

export function bridgeCompletedTemplate(
  amountUsdc: string,
  sourceChain: string,
  destChain: string,
  referenceId?: string,
  mintTxHash?: string,
  burnTxHash?: string
): string {
  const ref = referenceId || Math.random().toString(36).substring(2, 10).toUpperCase();

  /**
   * A hash we couldn't recover still represents money that arrived, so say so rather
   * than printing "N/A" against a completed transfer — it reads like a failure.
   */
  const hashRow = (label: string, chain: string, hash: string | undefined): ReceiptRow => {
    if (isPlaceholderHash(hash)) {
      return { label, value: 'Confirmed on-chain' };
    }
    return {
      label,
      value: shortenHash(hash!),
      isMonospace: true,
      href: explorerTxUrl(chain, hash),
    };
  };

  // The chains live in the row labels: the hashes are what someone actually needs, and
  // each one already says which network it belongs to.
  return baseReceiptTemplate(amountUsdc, [
    { label: 'Reference ID', value: ref, isMonospace: true },
    hashRow(`Burn Tx · ${sourceChain.toUpperCase()}`, sourceChain, burnTxHash),
    hashRow(`Mint Tx · ${destChain.toUpperCase()}`, destChain, mintTxHash),
  ]);
}

/**
 * Successful Transfer Out Receipt Template (sent to the Sender)
 */
export function transferSentTemplate(
  amountUsdc: string,
  recipient: string,
  referenceId?: string,
  note?: string,
  txHash?: string,
  chain?: string
): string {
  const ref = referenceId || Math.random().toString(36).substring(2, 10).toUpperCase();

  const rows: ReceiptRow[] = [
    { label: 'Reference ID', value: ref, isMonospace: true },
    isPlaceholderHash(txHash)
      ? { label: 'Transaction Receipt', value: `#${ref.substring(0, 8)}`, isMonospace: true }
      : {
          label: chain ? `Transaction · ${chain.toUpperCase()}` : 'Transaction Hash',
          value: shortenHash(txHash!),
          isMonospace: true,
          href: explorerTxUrl(chain ?? HOME_CHAIN, txHash),
        },
    { label: 'Sent To', value: recipient }
  ];
  
  if (note) {
    rows.push({ label: 'Note', value: note });
  }
  
  return baseReceiptTemplate(amountUsdc, rows);
}

/**
 * Security Alert Template
 * Used when a security setting changes (2FA on/off, passkey added/removed).
 */
export function securityAlertTemplate(title: string, body: string): string {
  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 12px; font-weight: 700; color: #B91C1C; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Security Alert</p>
      <h1 style="font-size: 28px; font-weight: 800; color: #111111; margin: 0 0 24px 0;">🔐 ${title}</h1>

      <div style="background-color: #FFF5F5; border: 1px solid #FECACA; border-radius: 16px; padding: 24px; margin: 0 0 24px 0; text-align: left;">
        <p style="font-size: 15px; line-height: 1.7; color: #7F1D1D; margin: 0;">${body}</p>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #404040; margin: 0 0 24px 0;">
        If you made this change, no action is needed. If you did <strong>not</strong> make this change,
        please secure your account immediately by resetting your password and contacting our support team.
      </p>

      <div style="margin-top: 24px;">
        <a href="${APP_URL}/dashboard/settings" style="display: inline-block; background-color: #111111; color: #ffffff !important; padding: 14px 36px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 15px;">
          Review Security Settings
        </a>
      </div>
    </div>
  `);
}


