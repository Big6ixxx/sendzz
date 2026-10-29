/**
 * An order id as a user sees it: without the payout provider's name, which is ours to know and
 * theirs to never see. `brails_1787262387835_k3x9qa` reads `1787262387835`; any other id keeps
 * everything but a leading provider name. Display only: lookups keep the stored id.
 */
export function publicOrderId(id: string): string {
  const brails = /^brails_(\d+)_[a-z0-9]+$/i.exec(id);
  if (brails) return brails[1];
  return id.replace(/^(brails|bitnob|paycrest)[_-]/i, "");
}
