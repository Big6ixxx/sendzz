/**
 * Operational alerts to the people who can act on them.
 *
 * Separate from `templates.ts` on purpose: those are customer emails, with a shared base that
 * every one of them renders through. An operational alert has a different job and a different
 * audience, and wiring it into that base would put every customer email one edit away from an
 * internal message.
 *
 * Two alerts live here, and they are different shapes:
 *
 *   * A refund owed — an EVENT. It happens once, costs a user money, and needs somebody to
 *     send USDC back by hand. Nothing surfaced these before; the first was found because the
 *     user complained, hours later.
 *   * A referral treasury running low — a CONDITION. It stays true until the wallet is topped
 *     up, and the job that notices it runs hourly, so it goes through the cooldown in
 *     lib/ops/alert-cooldown.ts rather than being sent on every run.
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

export interface ReferralTreasuryAlert {
  /** USDC currently in the payout wallet. */
  balanceUsdc: number;
  /** Total owed to referrers right now, paid or not. */
  pendingUsdc: number;
  /** How many referrers are waiting on it. */
  referrerCount: number;
  /** The wallet the sweep spends from. */
  walletId: string;
  chain: string;
  /** True when the balance cannot even cover what is owed today. */
  blocking: boolean;
}

/**
 * Tell the admins the referral payout wallet needs topping up.
 *
 * Sent BEFORE payouts start failing where possible, because the failure mode is otherwise
 * invisible: a sweep that cannot pay releases its earnings and retries next run, so nothing
 * breaks and nothing is lost — referral payments simply stop arriving, quietly, until somebody
 * happens to look.
 *
 * Rate-limited by the caller, not here. This function sends what it is asked to send; deciding
 * how often a standing condition is worth an email is a separate concern and lives in
 * lib/ops/alert-cooldown.ts.
 *
 * Never throws, for the same reason the refund alert does not: an alert that failed to send
 * must not take down the job that noticed the problem.
 */
export async function sendReferralTreasuryAlert(
  alert: ReferralTreasuryAlert,
): Promise<void> {
  try {
    const to = parseAdminRecipients(process.env.ADMIN_EMAILS);
    if (to.length === 0) {
      console.error(
        "[AdminAlert] referral treasury low but NO admin recipients configured — set ADMIN_EMAILS. " +
          `Balance ${alert.balanceUsdc.toFixed(2)} USDC against ${alert.pendingUsdc.toFixed(2)} owed.`,
      );
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://sendzz.io";
    const shortfall = Math.max(0, alert.pendingUsdc - alert.balanceUsdc);

    const rows: Array<[string, string]> = [
      ["Balance", `${esc(alert.balanceUsdc.toFixed(2))} USDC`],
      ["Owed to referrers", `${esc(alert.pendingUsdc.toFixed(2))} USDC`],
      ["Referrers waiting", esc(String(alert.referrerCount))],
      ["Shortfall", shortfall > 0 ? `${esc(shortfall.toFixed(2))} USDC` : "none yet"],
      ["Wallet", esc(alert.walletId)],
      ["Network", esc(alert.chain)],
    ];

    const MONO = new Set(["Wallet"]);
    const tableRows = rows
      .map(
        ([label, value]) => `
      <tr>
        <td style="padding: 14px 0; font-size: 11px; font-weight: 700; color: #707070; text-transform: uppercase; border-bottom: 1px dashed #E2E8E0;">${label}</td>
        <td style="padding: 14px 0; text-align: right; font-size: 13px; font-weight: 700; color: #111111; border-bottom: 1px dashed #E2E8E0; word-break: break-all;${MONO.has(label) ? " font-family: 'Courier New', Courier, monospace;" : ""}">${value}</td>
      </tr>`,
      )
      .join("");

    // Amber rather than red when it is only a warning. A heads-up that looks identical to an
    // emergency teaches people that emergencies can wait.
    const accent = alert.blocking ? "#B42318" : "#B54708";
    const badge = alert.blocking ? "Payouts blocked" : "Top up soon";

    const html = baseTemplate(`
    <div>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="left" valign="middle">
            <img src="${appUrl}/logo-black.svg" alt="Sendzz" width="90" style="display: block;">
          </td>
          <td align="right" valign="middle">
            <span style="background-color: ${accent}; color: #ffffff !important; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">${badge}</span>
          </td>
        </tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <h1 style="font-size: 38px; font-weight: 950; color: ${accent}; margin: 0; letter-spacing: -1.5px;">${esc(alert.balanceUsdc.toFixed(2))} USDC</h1>
        <p style="font-size: 13px; color: #707070; margin: 6px 0 0 0;">left in the referral payout wallet</p>
      </div>

      <p style="font-size: 14px; line-height: 1.7; color: #3f3f3f; margin: 0 0 8px 0;">
        ${
          alert.blocking
            ? "Referral payouts <strong>cannot be paid</strong> from this balance. Earnings are being held and retried each run, so nothing is lost — but referrers are not being paid until this wallet is topped up."
            : "Referral payouts are still going through, but the balance is getting close to what is owed. Topping it up now avoids payouts stalling."
        }
      </p>

      <p style="font-size: 14px; line-height: 1.7; color: #3f3f3f; margin: 0 0 8px 0;">
        This wallet does not fill itself. Deposit revenue sits with Paycrest, and bridge and
        withdrawal fees go to Bitnob-hosted addresses — none of it lands here. Topping up means
        withdrawing from those and sending USDC to this wallet on ${esc(alert.chain)}.
      </p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 16px; margin-bottom: 8px;">
        ${tableRows}
      </table>

      <p style="font-size: 12px; line-height: 1.7; color: #909090; margin: 20px 0 0 0; text-align: center;">
        Nothing is lost while this is unfunded. Earnings keep accruing and the first run after a
        top-up pays them.
      </p>
    </div>
  `);

    const text = [
      `${alert.blocking ? "PAYOUTS BLOCKED" : "TOP UP SOON"} — referral payout wallet`,
      ``,
      `Balance:           ${alert.balanceUsdc.toFixed(2)} USDC`,
      `Owed to referrers: ${alert.pendingUsdc.toFixed(2)} USDC`,
      `Referrers waiting: ${alert.referrerCount}`,
      `Shortfall:         ${shortfall > 0 ? `${shortfall.toFixed(2)} USDC` : "none yet"}`,
      `Wallet:            ${alert.walletId}`,
      `Network:           ${alert.chain}`,
      ``,
      `This wallet does not fill itself. Deposit revenue sits with Paycrest, and bridge and`,
      `withdrawal fees go to Bitnob-hosted addresses — none of it lands here. Top up by`,
      `withdrawing from those and sending USDC to this wallet on ${alert.chain}.`,
      ``,
      `Nothing is lost while it is unfunded: earnings keep accruing and the first run after`,
      `a top-up pays them.`,
    ].join("\n");

    const res = await sendEmail({
      to,
      subject: alert.blocking
        ? `[Action required] Referral payouts blocked — ${alert.balanceUsdc.toFixed(2)} USDC left`
        : `[Heads up] Referral payout wallet low — ${alert.balanceUsdc.toFixed(2)} USDC left`,
      html,
      text,
    });

    if (!res.success) {
      console.error(`[AdminAlert] referral-treasury email failed: ${res.error}`);
      return;
    }
    console.log(`[AdminAlert] referral-treasury alert sent to ${to.length} admin(s)`);
  } catch (err) {
    console.error("[AdminAlert] referral-treasury alert threw:", err);
  }
}
