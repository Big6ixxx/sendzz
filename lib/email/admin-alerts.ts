/**
 * Operational alerts to the people who can act on them.
 *
 * Separate from `templates.ts` on purpose: those are customer emails, with a shared base that
 * every one of them renders through. An operational alert has a different job and a different
 * audience, and wiring it into that base would put every customer email one edit away from an
 * internal message.
 *
 * The only alert here is the one that costs a user money: a withdrawal that failed AFTER their
 * deposit landed. Their USDC is gone from their wallet and no payout was made, so somebody has
 * to send it back by hand. Nothing surfaced these before — the first was found because the
 * user complained, hours later.
 */
import { explorerTxUrl } from "@/lib/explorers";
import { baseTemplate } from "./templates";
import { parseAdminRecipients } from "./admin-recipients";
import { sendEmail } from "./sendEmail";

export interface RefundOwedAlert {
  withdrawalId: string;
  orderId: string | null;
  userEmail: string;
  owedUsdc: number;
  amountUsdc: number;
  feeUsdc: number;
  fiatAmount: number | null;
  fiatCurrency: string;
  chain: string | null;
  /** The user's transfer in — proof their money left, and what an operator verifies first. */
  txHash: string | null;
  /** Where to send it back, when we hold a wallet for that chain. */
  refundAddress: string | null;
  provider: string | null;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Alert every admin that a refund is owed.
 *
 * Sent once per withdrawal: the caller is behind the same notification guard that stops a user
 * being told twice, so a webhook, the browser and the cron all noticing the same failure
 * produce one alert rather than three.
 *
 * Never throws. A failure to alert must not roll back the failure handling that produced it —
 * the debt is recorded in the database either way, and the admin dashboard lists it regardless.
 */
export async function sendRefundOwedAlert(alert: RefundOwedAlert): Promise<void> {
  try {
    // `ADMIN_EMAILS` alone: this alert fires when something is already broken, so it must
    // not depend on a database read to reach anyone.
    const to = parseAdminRecipients(process.env.ADMIN_EMAILS);
    if (to.length === 0) {
      console.error(
        "[AdminAlert] refund owed but NO admin recipients configured — set ADMIN_EMAILS. " +
          `Withdrawal ${alert.withdrawalId} owes ${alert.owedUsdc} USDC.`,
      );
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://sendzz.io";
    const explorer = explorerTxUrl(alert.chain, alert.txHash);

    const fiat =
      alert.fiatAmount != null
        ? `${alert.fiatAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${alert.fiatCurrency}`
        : "—";

    const rows: Array<[string, string]> = [
      ['User', esc(alert.userEmail)],
      ['Owed', `${esc(alert.owedUsdc.toFixed(6))} USDC`],
      ['Payout + fee', `${esc(alert.amountUsdc.toFixed(6))} + ${esc(alert.feeUsdc.toFixed(6))}`],
      ['Was to receive', esc(fiat)],
      ['Chain', esc(alert.chain ?? '—')],
      ['Provider', esc(alert.provider ?? '—')],
      ['Order', esc(alert.orderId ?? '—')],
      [
        'Send back to',
        alert.refundAddress
          ? esc(alert.refundAddress)
          : `no ${esc(alert.chain ?? '')} wallet on file — ask the user`,
      ],
    ];
    if (alert.txHash) {
      rows.push([
        'Their deposit',
        explorer
          ? `<a href="${esc(explorer)}" target="_blank" rel="noopener noreferrer" style="color:#006633 !important;text-decoration:underline;">${esc(alert.txHash)}</a>`
          : esc(alert.txHash),
      ]);
    }

    const MONO = new Set(['Order', 'Send back to', 'Their deposit']);
    const tableRows = rows
      .map(
        ([label, value]) => `
      <tr>
        <td style="padding: 14px 0; font-size: 11px; font-weight: 700; color: #707070; text-transform: uppercase; border-bottom: 1px dashed #E2E8E0;">${label}</td>
        <td style="padding: 14px 0; text-align: right; font-size: 13px; font-weight: 700; color: #111111; border-bottom: 1px dashed #E2E8E0; word-break: break-all;${MONO.has(label) ? " font-family: 'Courier New', Courier, monospace;" : ''}">${value}</td>
      </tr>`,
      )
      .join('');

    // Rendered inside the same shell as every customer email, so an alert looks like it came
    // from Sendzz rather than from a script. Only the badge and headline colour differ: this is
    // the one email that means something is wrong.
    const html = baseTemplate(`
    <div>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="left" valign="middle">
            <img src="${appUrl}/logo-black.svg" alt="Sendzz" width="90" style="display: block;">
          </td>
          <td align="right" valign="middle">
            <span style="background-color: #B42318; color: #ffffff !important; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">Action required</span>
          </td>
        </tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <h1 style="font-size: 38px; font-weight: 950; color: #B42318; margin: 0; letter-spacing: -1.5px;">${esc(alert.owedUsdc.toFixed(6))} USDC</h1>
        <p style="font-size: 13px; color: #707070; margin: 6px 0 0 0;">owed back to a user</p>
      </div>

      <p style="font-size: 14px; line-height: 1.7; color: #3f3f3f; margin: 0 0 8px 0;">
        A withdrawal failed <strong>after</strong> the user's deposit landed. Their USDC has left
        their wallet and no payout was made, so it has to be sent back manually.
      </p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 16px; margin-bottom: 8px;">
        ${tableRows}
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
        <tr>
          <td align="center">
            <a href="${appUrl}/admin/refunds" target="_blank" rel="noopener noreferrer"
               style="background-color:#006633;color:#ffffff !important;padding:14px 32px;border-radius:12px;font-size:14px;font-weight:800;text-decoration:none;display:inline-block;">
              Open Refunds Owed
            </a>
          </td>
        </tr>
      </table>

      <p style="font-size: 12px; line-height: 1.7; color: #909090; margin: 20px 0 0 0; text-align: center;">
        Record the transfer hash there once sent. The withdrawal then shows as reversed, and it
        cannot be paid twice.
      </p>
    </div>
  `);

    const text = [
      `ACTION REQUIRED — refund owed: ${alert.owedUsdc.toFixed(6)} USDC`,
      ``,
      `A withdrawal failed after the user's deposit landed. Their USDC has left their`,
      `wallet and no payout was made, so it must be sent back manually.`,
      ``,
      `User:          ${alert.userEmail}`,
      `Owed:          ${alert.owedUsdc.toFixed(6)} USDC (${alert.amountUsdc.toFixed(6)} payout + ${alert.feeUsdc.toFixed(6)} fee)`,
      `Was to receive:${fiat}`,
      `Chain:         ${alert.chain ?? "—"}`,
      `Provider:      ${alert.provider ?? "—"}`,
      `Order:         ${alert.orderId ?? "—"}`,
      `Send back to:  ${alert.refundAddress ?? `no ${alert.chain ?? ""} wallet on file — ask the user`}`,
      `Their deposit: ${alert.txHash ?? "—"}`,
      ``,
      `${appUrl}/admin/refunds`,
    ].join("\n");

    const res = await sendEmail({
      to,
      subject: `[Action required] Refund owed — ${alert.owedUsdc.toFixed(2)} USDC to ${alert.userEmail}`,
      html,
      text,
    });

    if (!res.success) {
      console.error(`[AdminAlert] refund-owed email failed: ${res.error}`);
      return;
    }
    console.log(
      `[AdminAlert] refund-owed alert sent to ${to.length} admin(s) for ${alert.orderId}`,
    );
  } catch (err) {
    console.error("[AdminAlert] refund-owed alert threw:", err);
  }
}
