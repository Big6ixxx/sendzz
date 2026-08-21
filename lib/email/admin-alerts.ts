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

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:#8a8a8a;font-size:13px;white-space:nowrap;">${esc(label)}</td>
    <td style="padding:8px 0 8px 20px;color:#f8f8f6;font-size:13px;font-weight:600;word-break:break-all;">${value}</td>
  </tr>`;
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

    const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#121214;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <div style="padding:20px 24px;background:rgba(239,68,68,0.1);border-bottom:1px solid rgba(239,68,68,0.2);">
      <p style="margin:0;color:#ef4444;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Action required</p>
      <h1 style="margin:6px 0 0;color:#f8f8f6;font-size:19px;font-weight:800;">Refund owed &mdash; ${esc(alert.owedUsdc.toFixed(6))} USDC</h1>
    </div>

    <div style="padding:24px;">
      <p style="margin:0 0 20px;color:#b4b4b4;font-size:13.5px;line-height:1.6;">
        A withdrawal failed <strong style="color:#f8f8f6;">after</strong> the user's deposit landed.
        Their USDC has left their wallet and no payout was made, so it has to be sent back manually.
      </p>

      <table style="width:100%;border-collapse:collapse;">
        ${row("User", esc(alert.userEmail))}
        ${row("Owed", `${esc(alert.owedUsdc.toFixed(6))} USDC <span style="color:#8a8a8a;font-weight:400;">(${esc(alert.amountUsdc.toFixed(6))} payout + ${esc(alert.feeUsdc.toFixed(6))} fee)</span>`)}
        ${row("Was to receive", esc(fiat))}
        ${row("Chain", esc(alert.chain ?? "—"))}
        ${row("Provider", esc(alert.provider ?? "—"))}
        ${row("Order", esc(alert.orderId ?? "—"))}
        ${
          alert.refundAddress
            ? row("Send back to", `<code style="font-size:11.5px;">${esc(alert.refundAddress)}</code>`)
            : row("Send back to", `<span style="color:#f59e0b;font-weight:400;">no ${esc(alert.chain ?? "")} wallet on file &mdash; ask the user</span>`)
        }
        ${
          alert.txHash
            ? row(
                "Their deposit",
                explorer
                  ? `<a href="${esc(explorer)}" style="color:#00e87a;text-decoration:none;font-size:11.5px;">${esc(alert.txHash.slice(0, 24))}&hellip;</a>`
                  : `<code style="font-size:11.5px;">${esc(alert.txHash)}</code>`,
              )
            : ""
        }
      </table>

      <a href="${esc(appUrl)}/admin/refunds"
         style="display:block;margin-top:24px;padding:13px;background:#00e87a;color:#04120a;text-align:center;text-decoration:none;border-radius:11px;font-size:13.5px;font-weight:800;">
        Open Refunds Owed
      </a>

      <p style="margin:18px 0 0;color:#6a6a6a;font-size:11.5px;line-height:1.6;">
        Record the transfer hash on that page once you have sent it. The withdrawal then shows as
        reversed, and it cannot be paid twice.
      </p>
    </div>
  </div>
</body></html>`;

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
