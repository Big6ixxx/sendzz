/**
 * Email Templates
 *
 * Modern, responsive email templates for Sendzz.
 * Using inline styles and robust table layouts for maximum compatibility.
 */

const BRAND_COLOR = "#1F5E12";
const APP_URL = "https://yunusabdul.vercel.app";

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
    
    .coil-bg {
      background-image: url("data:image/svg+xml,%3Csvg width='40' height='20' viewBox='0 0 40 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0 C 5 0 5 15 10 15 C 15 15 15 0 20 0 C 25 0 25 15 30 15 C 35 15 35 0 40 0 L 40 20 L 0 20 Z' fill='%23DDEAF8'/%3E%3C/svg%3E");
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100% !important; background-color: #F2FBF1; font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="width: 100%; background-color: #F2FBF1; padding: 40px 0;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 584px; margin: 0 auto; background-color: #F2FBF1;">
      <!-- Header -->
      <tr>
        <td align="center" style="background-color: #0E2406; border-radius: 24px 24px 0 0; padding: 60px 20px; background-image: url('${APP_URL}/heqaderBg.svg'); background-repeat: no-repeat; background-position: center;">
          <img src="${APP_URL}/logo.svg" alt="Sendzz" width="180" style="display: block;">
        </td>
      </tr>
      
      <!-- Main Content Card -->
      <tr>
        <td style="background-color: #ffffff; padding: 40px 20px;">
          ${content}
        </td>
      </tr>
      
      <!-- THE COIL (WAVY DIVIDER) - PRESERVED AS REQUESTED -->
      <tr>
        <td height="20" class="coil-bg" style="background-color: #ffffff; padding: 0; line-height: 0; font-size: 0; background-image: url('data:image/svg+xml,%3Csvg width='40' height='20' viewBox='0 0 40 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0 C 5 0 5 15 10 15 C 15 15 15 0 20 0 C 25 0 25 15 30 15 C 35 15 35 0 40 0 L 40 20 L 0 20 Z' fill='%23DDEAF8'/%3E%3C/svg%3E'); background-repeat: repeat-x; background-size: 40px 20px;">
          <!--[if gte mso 9]>
          <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:584px;height:20px;">
            <v:fill type="tile" src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0nNDAnIGhlaWdodD0nMjAnIHZpZXdCb3g9JzAgMCA0MCAyMCcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJz48cGF0aCBkPSdNMCAwIEMgNSAwIDUgMTUgMTAgMTUgQyAxNSAxNSAxNSAwIDIwIDAgQyAyNSAwIDI1IDE1IDMwIDE1IEMgMzUgMTUgMzUgMCA0MCAwIEwgNDAgMjAgTCAwIDIwIFonIGZpbGw9JyNEREVBRjgnLz48L3N2Zz4=" color="#DDEAF8" />
          </v:rect>
          <![endif]-->
          &nbsp;
        </td>
      </tr>
      
      <!-- Footer Illustration with Positioned Text -->
      <tr>
        <td align="center" style="padding: 40px 20px; color: #006633;">
          <p style="margin: 0 0 4px 0; font-size: 16px; line-height: 1.6; font-weight: 500;">Its secured to your email and ready for your bank.</p>
          <p style="margin: 0 0 4px 0; font-size: 16px; line-height: 1.6; font-weight: 500;">No codes or waiting</p>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; font-weight: 500;">Click above to get your money now</p>
          
          <!-- ILLUSTRATION PRESERVED AS REQUESTED (COMMENTED OUT) -->
          <!-- 
          <div style="margin-top: 40px; position: relative; width: 100%; max-width: 450px;">
            <img src="${APP_URL}/Layer_x0020_1.svg" alt="Illustration" width="450" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
            
            <div style="position: absolute; left: 16%; top: 40%; width: 140px; text-align: center; transform: skewY(-15deg) rotate(-10deg);">
               <p style="margin: 0; font-size: 12px; font-weight: 700; color: #1F5E12; line-height: 1;">Send Crypto as Easily as</p>
               <p style="margin: 2px 0 0 0; font-size: 26px; font-weight: 900; color: #1F5E12; line-height: 1; font-style: italic;">EMAIL</p>
            </div>
            
            <div style="position: absolute; right: 10%; top: 38%; width: 160px; text-align: left; transform: skewY(18deg) rotate(8deg);">
               <p style="margin: 0; font-size: 13px; font-weight: 800; color: #1F5E12; line-height: 1.1; opacity: 0.9;">Transfer USDC, BTC, ETH, and more directly to any email address</p>
            </div>
          </div>
          -->
          
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
  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 12px; font-weight: 700; color: #1F5E12; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Verification Code</p>
      <h1 style="font-size: 28px; font-weight: 800; color: #111111; margin: 0 0 24px 0;">Sign in to Sendzz</h1>
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 32px 0;">Enter this code to verify your email and complete sign in:</p>
      
      <div style="background-color: #F2FBF1; border-radius: 16px; padding: 32px; margin: 0 0 32px 0;">
        <div style="font-family: 'Courier New', Courier, monospace; font-size: 42px; font-weight: 900; letter-spacing: 10px; color: #1F5E12;">${code}</div>
      </div>
      
      <p style="font-size: 14px; color: #94a3b8; margin: 0;">This code expires in 10 minutes. Don't share it with anyone.</p>
    </div>
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
    <div style="text-align: center;">
      <p style="font-size: 12px; font-weight: 700; color: #1F5E12; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Withdrawal Verification</p>
      <h1 style="font-size: 28px; font-weight: 800; color: #111111; margin: 0 0 24px 0;">Confirm Your Withdrawal</h1>
      
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 16px 0;">You're about to withdraw:</p>
      <div style="background-color: #F2FBF1; border-radius: 16px; padding: 24px; margin: 0 0 16px 0;">
        <div style="font-size: 32px; font-weight: 900; color: #1F5E12;">${amount}</div>
        <div style="font-size: 14px; color: #006633; font-weight: 600; margin-top: 4px;">USDC → ${currency}</div>
      </div>
      
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 16px 0;">Enter this code to confirm:</p>
      <div style="background-color: #F2FBF1; border-radius: 16px; padding: 32px; margin: 0 0 16px 0;">
        <div style="font-family: 'Courier New', Courier, monospace; font-size: 42px; font-weight: 900; letter-spacing: 10px; color: #1F5E12;">${code}</div>
      </div>
      
      <p style="font-size: 14px; color: #94a3b8; margin: 0;">If you didn't request this withdrawal, please contact support immediately.</p>
    </div>
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
    ? `<p style="font-style: italic; color: #64748b; margin-bottom: 24px;">"${note}"</p>`
    : "";

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 12px; font-weight: 700; color: #1F5E12; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Payment Received</p>
      <h1 style="font-size: 28px; font-weight: 800; color: #111111; margin: 0 0 24px 0;">You've received money! 🎉</h1>
      
      <div style="background-color: #F2FBF1; border-radius: 16px; padding: 32px; margin: 0 0 24px 0;">
        <div style="font-size: 48px; font-weight: 900; color: #1F5E12; letter-spacing: -1px;">${amount}</div>
        <div style="font-size: 16px; color: #006633; font-weight: 700;">USDC</div>
      </div>
      
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 12px 0;">Sent by: <strong>${senderEmail}</strong></p>
      ${noteSection}
      
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 24px 0;">Click below to claim your funds:</p>
      <a href="${claimUrl}" style="display: inline-block; background-color: #67ED0A; color: #004421 !important; padding: 14px 40px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 18px;">Claim Your Funds</a>
      
      <p style="font-size: 13px; color: #94a3b8; margin-top: 24px;">This link expires in 7 days.</p>
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
): string {
  const noteSection = note
    ? `<p style="font-style: italic; color: #64748b; margin-bottom: 24px;">"${note}"</p>`
    : "";

  return baseTemplate(`
    <div style="text-align: center;">
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 32px 0;">
        Hi there, <strong>${senderEmail}</strong> just sent you <strong>${amount}</strong> using <span style="color: #1F5E12; font-weight: 900;">Sendzz</span>
      </p>
      
      <div style="font-size: 48px; font-weight: 900; color: #1F5E12; margin: 0 0 40px 0; letter-spacing: -1px;">${amount} USDC</div>
      
      <div style="max-width: 440px; margin: 0 auto; text-align: left;">
        <h2 style="font-size: 18px; font-weight: 800; color: #111111; margin: 0 0 10px 0;">What's next?</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 20px 0;">Once you click the link and log in with your email, you can:</p>
        
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;">Transfer to your bank: Send the funds directly to your local bank account.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;">Keep it in your Sendzz account: Save it for later or use it to pay someone else.</td>
          </tr>
          <tr>
            <td width="20" valign="top" style="padding-top: 8px;"><div style="width: 6px; height: 6px; background-color: #404040; border-radius: 50%;"></div></td>
            <td style="padding-bottom: 12px; font-size: 16px; line-height: 1.4; color: #404040;">Send it to a friend: All you need is their email address to pass the money along.</td>
          </tr>
        </table>
      </div>

      ${noteSection}

      <div style="margin-top: 32px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td><img src="${APP_URL}/Group 248.png" width="48" style="display: block; opacity: 0.7; margin-right: 20px;"></td>
            <td><a href="#" style="display: inline-block; background-color: #67ED0A; color: #004421 !important; padding: 14px 40px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 18px;">Access My Funds</a></td>
            <td><img src="${APP_URL}/Group 248.png" width="48" style="display: block; opacity: 0.7; margin-left: 20px;"></td>
          </tr>
        </table>
      </div>
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
    <div style="text-align: center;">
      <p style="font-size: 12px; font-weight: 700; color: #1F5E12; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Withdrawal Complete</p>
      <h1 style="font-size: 28px; font-weight: 800; color: #111111; margin: 0 0 24px 0;">Payout Successful ✅</h1>
      
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin: 0 0 24px 0;">Your withdrawal has been processed:</p>
      
      <div style="background-color: #F2FBF1; border-radius: 16px; padding: 24px; margin: 0 0 16px 0; text-align: left;">
        <p style="font-size: 10px; font-weight: 700; color: #1F5E12; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Converted</p>
        <p style="font-size: 20px; font-weight: 800; color: #111111; margin: 0;">${amountUsdc} USDC → ${fiatAmount} ${currency}</p>
      </div>
      
      <div style="background-color: #F2FBF1; border-radius: 16px; padding: 24px; margin: 0 0 16px 0; text-align: left;">
        <p style="font-size: 10px; font-weight: 700; color: #1F5E12; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Sent To</p>
        <p style="font-size: 20px; font-weight: 800; color: #111111; margin: 0;">Account ending ${bankMasked}</p>
      </div>
      
      <p style="font-size: 16px; line-height: 1.6; color: #404040; margin-top: 24px;">Funds should arrive within 1-2 business days.</p>
    </div>
  `);
}
