#!/usr/bin/env node
/**
 * Fail CI on a NEW dependency advisory, not on the backlog.
 *
 * `pnpm audit --prod` currently reports well over a hundred findings, and almost none are ours
 * to fix: they arrive through @privy-io/react-auth, @circle-fin/*, @solana/*, next and eslint,
 * and a large share reach us via react-native — pulled in by Privy's wallet connectors — which
 * never executes in a web build.
 *
 * A gate that fails on all of them fails on the first run, and a gate that fails on the first
 * run gets switched off within a week. So the existing set is recorded as a baseline and this
 * fails only on something that was not there before: a new advisory, or an existing one that
 * has become more severe.
 *
 * The baseline is a debt, not an amnesty. Shrinking it is the work; this only stops it growing
 * while nobody is looking.
 *
 *   node scripts/audit-check.mjs            check against the baseline
 *   node scripts/audit-check.mjs --update   record the current set as the new baseline
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';

const BASELINE = 'audit-baseline.json';
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

const run = promisify(execFile);

async function currentAdvisories() {
  let stdout = '';
  try {
    ({ stdout } = await run('pnpm', ['audit', '--prod', '--json'], {
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (err) {
    // pnpm exits non-zero whenever anything is found, which is the normal case here.
    stdout = err.stdout ?? '';
    if (!stdout) throw err;
  }

  const report = JSON.parse(stdout);
  const out = {};
  for (const advisory of Object.values(report.advisories ?? {})) {
    // Keyed on module + advisory rather than the numeric id, which is not stable across
    // registries and would churn the baseline for no reason.
    out[`${advisory.module_name}:${advisory.github_advisory_id ?? advisory.id}`] =
      advisory.severity;
  }
  return out;
}

const current = await currentAdvisories();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Baseline updated: ${Object.keys(current).length} known advisories.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No ${BASELINE}. Run: node scripts/audit-check.mjs --update`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

const added = [];
const worsened = [];
for (const [key, severity] of Object.entries(current)) {
  if (!(key in baseline)) added.push(`${severity.padEnd(8)} ${key}`);
  else if (RANK[severity] > RANK[baseline[key]]) {
    worsened.push(`${baseline[key]} -> ${severity}  ${key}`);
  }
}

// Worth reporting: it means somebody fixed something, and the baseline should shrink to match.
const fixed = Object.keys(baseline).filter((k) => !(k in current));

if (fixed.length) {
  console.log(`${fixed.length} advisory(ies) no longer present. Re-run with --update.`);
}

if (!added.length && !worsened.length) {
  console.log(`No new advisories. ${Object.keys(current).length} known.`);
  process.exit(0);
}

if (added.length) console.error(`\nNEW advisories (${added.length}):\n  ${added.join('\n  ')}`);
if (worsened.length) {
  console.error(`\nWORSENED (${worsened.length}):\n  ${worsened.join('\n  ')}`);
}
console.error(
  `\nFix it, or — if it is genuinely unreachable at runtime, as the react-native ones are —\n` +
    `record it with: node scripts/audit-check.mjs --update\n`,
);
process.exit(1);
