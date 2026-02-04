/**
 * Email Templates
 *
 * Modern, responsive email templates for Sendzz.
 */

const BRAND_COLOR = '#2563eb';
const BRAND_GRADIENT = 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)';

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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 0 auto; padding: 32px 16px; }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo-text { font-size: 28px; font-weight: 800; color: ${BRAND_COLOR}; letter-spacing: -0.5px; }
    .card { background: #ffffff; border-radius: 24px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
    .button { display: inline-block; background: ${BRAND_COLOR}; color: #ffffff !important; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .button:hover { opacity: 0.9; }
    .footer { text-align: center; margin-top: 24px; color: #94a3b8; font-size: 12px; line-height: 1.6; }
    .highlight { background: linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%); border-radius: 16px; padding: 20px; margin: 16px 0; }
    .code { font-family: "SF Mono", Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0f172a; text-align: center; }
    .amount { font-size: 40px; font-weight: 800; color: #0f172a; }
    .currency { font-size: 16px; color: #64748b; vertical-align: middle; margin-left: 4px; }
    .label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    p { color: #475569; font-size: 15px; line-height: 1.6; margin: 12px 0; }
    a { color: ${BRAND_COLOR}; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <span class="logo-text">💸 SENDZZ</span>
    </div>
    <div class="card">
      ${content}
    </div>
    <div class="footer">
      <p>Sendzz • Fast & Borderless Payments</p>
      <p>If you didn't request this, please ignore this email.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * OTP Login Email Template
 */
export function otpLoginTemplate(code: string): string {
  return baseTemplate(`
    <p class="label">Verification Code</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">Sign in to Sendzz</h1>
    <p>Enter this code to verify your email and complete sign in:</p>
    <div class="highlight">
      <div class="code">${code}</div>
    </div>
    <p style="font-size: 13px; color: #94a3b8;">This code expires in 10 minutes. Don't share it with anyone.</p>
  `);
}

/**
 * Withdrawal Verification OTP Template
 */
export function withdrawalOTPTemplate(
  code: string,
  amount: string,
  currency: string,
): string {
  return baseTemplate(`
    <p class="label">Withdrawal Verification</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">Confirm Your Withdrawal</h1>
    <p>You're about to withdraw:</p>
    <div class="highlight" style="text-align: center;">
      <span class="amount">${amount}</span>
      <span class="currency">USDC → ${currency}</span>
    </div>
    <p>Enter this code to confirm:</p>
    <div class="highlight">
      <div class="code">${code}</div>
    </div>
    <p style="font-size: 13px; color: #94a3b8;">If you didn't request this withdrawal, please contact support immediately.</p>
  `);
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
    ? `<p style="font-style: italic; color: #64748b;">"${note}"</p>`
    : '';

  return baseTemplate(`
    <p class="label">Payment Received</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">You've received money! 🎉</h1>
    <div class="highlight" style="text-align: center;">
      <span class="amount">${amount}</span>
      <span class="currency">USDC</span>
    </div>
    <p>Sent by: <strong>${senderEmail}</strong></p>
    ${noteSection}
    <p>Click below to claim your funds:</p>
    <div style="text-align: center;">
      <a href="${claimUrl}" class="button">Claim Your Funds</a>
    </div>
    <p style="font-size: 13px; color: #94a3b8;">This link expires in 7 days.</p>
  `);
}

/**
 * Transfer Received (Instant) Template
 */
export function transferReceivedTemplate(
  amount: string,
  senderEmail: string,
  note?: string,
): string {
  const noteSection = note
    ? `<p style="font-style: italic; color: #64748b;">"${note}"</p>`
    : '';

  return baseTemplate(`
    <p class="label">Payment Received</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">You've received money! 🎉</h1>
    <div class="highlight" style="text-align: center;">
      <span class="amount">${amount}</span>
      <span class="currency">USDC</span>
    </div>
    <p>Sent by: <strong>${senderEmail}</strong></p>
    ${noteSection}
    <p>The funds have been added to your Sendzz balance.</p>
    <div style="text-align: center;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || ''}" class="button">View Dashboard</a>
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
): string {
  return baseTemplate(`
    <p class="label">Withdrawal Complete</p>
    <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">Payout Successful ✅</h1>
    <p>Your withdrawal has been processed:</p>
    <div class="highlight">
      <p class="label">Converted</p>
      <p style="font-size: 18px; font-weight: 600; color: #0f172a;">${amountUsdc} USDC → ${fiatAmount} ${currency}</p>
    </div>
    <div class="highlight">
      <p class="label">Sent To</p>
      <p style="font-size: 18px; font-weight: 600; color: #0f172a;">Account ending ${bankMasked}</p>
    </div>
    <p>Funds should arrive within 1-2 business days.</p>
  `);
}
