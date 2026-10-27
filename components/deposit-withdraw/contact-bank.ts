import type { RampInstitution } from "@/lib/ramp/types";

function normalizeBankName(s: string): string {
  const normalized = (s || "")
    .toLowerCase()
    .replace(/\b(bank|plc|ltd|limited|nigeria|microfinance|mfb|company)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

  // Map common abbreviations and aliases to a single canonical term
  if (
    normalized === "gtb" ||
    normalized === "gt" ||
    normalized === "gtbank" ||
    normalized === "guarantytrust" ||
    normalized === "guarantytrustbank"
  ) {
    return "gtb";
  }
  if (normalized === "uba" || normalized === "unitedforafrica") {
    return "uba";
  }
  if (normalized === "fcmb" || normalized === "firstcitymonument") {
    return "fcmb";
  }
  if (normalized === "first" || normalized === "firstbank" || normalized === "fbn") {
    return "firstbank";
  }
  if (normalized === "stanbic" || normalized === "stanbicibtc" || normalized === "ibtc") {
    return "stanbic";
  }
  if (normalized === "access" || normalized === "accessbank") {
    return "access";
  }
  if (normalized === "zenith" || normalized === "zenithbank") {
    return "zenith";
  }
  if (normalized === "sterling" || normalized === "sterlingbank") {
    return "sterling";
  }
  if (normalized === "wema" || normalized === "wemabank") {
    return "wema";
  }
  if (normalized === "union" || normalized === "unionbank") {
    return "union";
  }
  if (normalized === "keystone" || normalized === "keystonebank") {
    return "keystone";
  }
  if (normalized === "polaris" || normalized === "polarisbank") {
    return "polaris";
  }
  if (normalized === "fidelity" || normalized === "fidelitybank") {
    return "fidelity";
  }
  if (normalized === "ecobank") {
    return "ecobank";
  }

  return normalized;
}

/**
 * The institution a saved contact's bank is in the current country's list, or null when it is
 * not there. Contacts carry no country, so this is the only way to tell which corridor one
 * belongs to: a Nigerian bank is simply absent from the Kenyan operator list.
 *
 * Exact, like `pickBank`: the contact's code where the names agree, or the one entry with the
 * same name. No partial matching — that is how "CIT Microfinance" became Citibank.
 */
export function matchContactBank(
  insts: RampInstitution[],
  contact: { bankCode: string; bankName: string },
): { code: string; name: string } | null {
  const target = normalizeBankName(contact.bankName);
  const code = contact.bankCode?.trim().toUpperCase();
  const byCode = code && insts.find((b) => b.code?.trim().toUpperCase() === code);
  if (byCode && (!target || normalizeBankName(byCode.name) === target)) {
    return { code: byCode.code, name: byCode.name };
  }

  if (!target) return null;
  const byName = insts.filter((b) => normalizeBankName(b.name) === target);
  return byName.length === 1 ? { code: byName[0].code, name: byName[0].name } : null;
}
