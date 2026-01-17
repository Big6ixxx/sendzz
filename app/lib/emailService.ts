import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendNotificationEmail = async (toEmail: string, amount: string, txId: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  console.log(process.env.NEXT_PUBLIC_BASE_URL ,process.env.RESEND_API_KEY) 
  const claimLink = `${baseUrl}/claim?txId=${txId}`;

  try {
    await resend.emails.send({
      // ✅ Use a clear name. Note: Using onboarding@resend.dev often triggers spam warnings
      // unless you verify a domain in the Resend dashboard.
      from: 'Universal Mail Gateway <onboarding@resend.dev>', 
      to: toEmail,
      replyTo: 'support@yourdomain.com', // Makes it look more legitimate
      subject: `💰 You received ${amount} USDC!`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            .container { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff; }
            .logo { font-size: 24px; font-weight: bold; color: #2563eb; margin-bottom: 24px; text-align: center; }
            .card { border: 1px solid #e2e8f0; border-radius: 24px; padding: 32px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
            .amount { font-size: 48px; font-weight: 800; color: #0f172a; margin: 16px 0; }
            .currency { font-size: 18px; color: #64748b; vertical-align: middle; }
            .button { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 16px 32px; border-radius: 16px; text-decoration: none; font-weight: bold; margin-top: 24px; }
            .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">💸 Universal Mail</div>
            <div class="card">
              <p style="margin: 0; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 12px;">Payment Received</p>
              <h1 class="amount">${amount} <span class="currency">USDC</span></h1>
              <p style="color: #475569; font-size: 14px; line-height: 1.5;">A deposit has been made to your email-based wallet. Click the secure link below to access your funds.</p>
              <a href="${claimLink}" class="button">Access My Wallet</a>
            </div>
            <div class="footer">
              <p>Transaction ID: ${txId}</p>
              <p>Universal Mail • Decentralized Email-to-Wallet Gateway</p>
              <p style="font-size: 10px; margin-top: 10px;">If you weren't expecting this, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    console.log(`📧 Receipt sent to ${toEmail}`);
  } catch (error) {
    console.error('❌ Resend Error:', error);
  }
};