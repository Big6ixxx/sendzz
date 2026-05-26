'use client';

import { AdminTransaction } from '@/types/admin';
import { format } from 'date-fns';
import { PAGE_BG, FONT_STYLES } from './template';
import { getTxHash, getChainInfo } from './txHelpers';

type DateRange = '7d' | '30d' | '6m' | '1y' | 'all';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7 Days',
  '30d': '1 Month',
  '6m': '6 Months',
  '1y': '1 Year',
  all: 'All Time',
};

const LOGO_PATH = '/logo-black.svg';
const ROWS_PER_PAGE = 22;

// ─── Block explorers ──────────────────────────────────────────────────────────
// Keyed by chain name (lowercase). Transfers have no chain so fall back to base.

const EXPLORERS: Record<string, string> = {
  ethereum:  'https://etherscan.io/tx',
  avalanche: 'https://snowtrace.io/tx',
  optimism:  'https://optimistic.etherscan.io/tx',
  arbitrum:  'https://arbiscan.io/tx',
  base:      'https://basescan.org/tx',
  polygon:   'https://polygonscan.com/tx',
};

function explorerUrl(tx: AdminTransaction, hash: string): string {
  if (hash === '—' || !hash) return '';
  // Bridge: burn hash lives on source_chain, mint hash on base (dest)
  if (tx.tx_type === 'bridge') {
    const chain = (tx.source_chain || 'base').toLowerCase();
    return `${EXPLORERS[chain] ?? EXPLORERS.base}/${hash}`;
  }
  // Transfers, deposits, withdrawals all settle on Base
  return `${EXPLORERS.base}/${hash}`;
}

function mintExplorerUrl(hash: string): string {
  if (!hash) return '';
  // Mint always happens on Base (destination)
  return `${EXPLORERS.base}/${hash}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMintHash(tx: AdminTransaction): string {
  if (tx.tx_type === 'bridge' && 'mint_tx_hash' in tx)
    return (tx.mint_tx_hash as string | null) || '';
  return '';
}

function isSettled(tx: AdminTransaction): boolean {
  const s = tx.status.toLowerCase();
  return ['completed', 'confirmed', 'complete', 'claimed', 'settled', 'success'].includes(s);
}

// ─── CSS constants ────────────────────────────────────────────────────────────

const thBase =
  'padding:9px 14px;text-align:left;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#ffffff;white-space:nowrap;';
const tdBase =
  "padding:9px 14px;vertical-align:middle;border-bottom:1px solid #e8f0e4;font-family:'Geist',-apple-system,sans-serif;font-size:10px;";

// ─── Link metadata collected per page ────────────────────────────────────────

interface LinkMeta {
  elementId: string;
  url: string;
}

// ─── Page HTML builder ────────────────────────────────────────────────────────

function buildTablePage(
  rows: AdminTransaction[],
  pageIndex: number,
  logoSrc: string,
  dateRange: DateRange,
  summary: { total: number; volume: number; byType: Record<string, number> },
  isFirstPage: boolean,
): { html: string; links: LinkMeta[] } {
  const generatedAt = format(new Date(), 'dd MMM yyyy, HH:mm') + ' UTC';
  const rangeLabel = DATE_RANGE_LABELS[dateRange];
  const links: LinkMeta[] = [];

  const rowsHtml = rows
    .map((tx, i) => {
      const hash = getTxHash(tx);
      const mintHash = getMintHash(tx);
      const shortHash = hash !== '—' ? `${hash.slice(0, 14)}…${hash.slice(-10)}` : '—';
      const shortMint = mintHash ? `${mintHash.slice(0, 10)}…${mintHash.slice(-8)}` : '';
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f5faf2';

      const hashId = `hash-${pageIndex}-${i}`;
      const mintId = `mint-${pageIndex}-${i}`;

      const burnUrl = explorerUrl(tx, hash);
      const mintUrl = mintExplorerUrl(mintHash);

      if (burnUrl) links.push({ elementId: hashId, url: burnUrl });
      if (mintUrl && mintHash) links.push({ elementId: mintId, url: mintUrl });

      return `
        <tr style="background:${rowBg};">
          <td style="${tdBase}color:#bbb;font-size:8.5px;width:28px;">${i + 1}</td>
          <td style="${tdBase}font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;color:#1a1a1a;letter-spacing:-0.01em;">
            <span id="${hashId}" style="${burnUrl ? 'color:#0066cc;text-decoration:underline;cursor:pointer;' : ''}">
              ${shortHash}
            </span>
            ${mintHash ? `
            <div style="font-size:7.5px;margin-top:2px;font-family:'JetBrains Mono','Courier New',monospace;">
              <span style="color:#aaa;">↳ mint: </span>
              <span id="${mintId}" style="color:#7c3aed;${mintUrl ? 'text-decoration:underline;cursor:pointer;' : ''}">
                ${shortMint}
              </span>
            </div>` : ''}
          </td>
          <td style="${tdBase}color:#555;font-size:9.5px;">${getChainInfo(tx)}</td>
          <td style="${tdBase}font-weight:700;font-size:11px;color:#1a1a1a;text-align:right;white-space:nowrap;">
            $${Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </td>
          <td style="${tdBase}font-size:9px;color:#888;white-space:nowrap;text-align:right;">
            ${format(new Date(tx.created_at), 'dd MMM yyyy')}<br/>
            <span style="color:#bbb;font-size:8px;">${format(new Date(tx.created_at), 'HH:mm')} UTC</span>
          </td>
        </tr>`;
    })
    .join('');

  const summaryParts = [
    `Total Transactions: <strong>${summary.total}</strong>`,
    `Total Volume: <strong>$${summary.volume.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC</strong>`,
    ...Object.entries(summary.byType).map(
      ([type, count]) =>
        `${type.charAt(0).toUpperCase() + type.slice(1)}s: <strong>${count}</strong>`,
    ),
  ];

  const summaryHtml = isFirstPage
    ? `<div style="font-size:10px;color:#666;margin-bottom:20px;line-height:2;font-family:'Geist',-apple-system,sans-serif;">
        ${summaryParts.join('<span style="margin:0 10px;color:#ccc;">·</span>')}
      </div>`
    : '';

  const html = `
<div style="background:${PAGE_BG};width:1100px;min-width:1100px;max-width:1100px;padding:44px 48px;font-family:'Geist',-apple-system,BlinkMacSystemFont,sans-serif;box-sizing:border-box;display:block;">

  <div style="margin-bottom:6px;">
    <img src="${logoSrc}" width="64" alt="Sendzz" style="display:block;" />
  </div>

  <div style="margin-bottom:28px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.03em;margin-bottom:4px;">Transaction Hash Export</div>
    <div style="font-size:10px;color:#999;font-weight:500;">
      Period: ${rangeLabel}&nbsp;&nbsp;·&nbsp;&nbsp;Generated ${generatedAt}&nbsp;&nbsp;·&nbsp;&nbsp;Settled transactions only
    </div>
  </div>

  <div style="height:1px;background:#d8ecd0;margin-bottom:20px;"></div>

  ${summaryHtml}

  <table style="width:100%;border-collapse:collapse;font-family:'Geist',-apple-system,sans-serif;">
    <thead>
      <tr style="background:#1a1a1a;">
        ${['#', 'TX Hash', 'Chain / Route', 'Amount (USDC)', 'Date (UTC)']
          .map((h, i) => `<th style="${thBase}${i === 3 || i === 4 ? 'text-align:right;' : ''}">${h}</th>`)
          .join('')}
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div style="margin-top:28px;padding-top:14px;border-top:1px solid #d8ecd0;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:8px;color:#bbb;font-weight:500;">Sendzz Platform · Confidential · No user details included</div>
    <div style="font-size:8px;color:#bbb;">${generatedAt}</div>
  </div>

</div>`;

  return { html, links };
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportTransactionsPDF(
  transactions: AdminTransaction[],
  dateRange: DateRange,
): Promise<void> {
  const settled = transactions.filter(isSettled);

  const logoSvgText = await fetch(LOGO_PATH).then((r) => r.text());
  const logoSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvgText)}`;

  const styleEl = document.createElement('style');
  styleEl.textContent = FONT_STYLES;
  document.head.appendChild(styleEl);
  if (document.fonts) await document.fonts.ready;

  const { toPng } = await import('html-to-image');
  const { jsPDF } = await import('jspdf');

  const summary = {
    total: settled.length,
    volume: settled.reduce((s, t) => s + Number(t.amount), 0),
    byType: settled.reduce<Record<string, number>>((acc, t) => {
      acc[t.tx_type] = (acc[t.tx_type] || 0) + 1;
      return acc;
    }, {}),
  };

  const pages: AdminTransaction[][] = [];
  for (let i = 0; i < settled.length; i += ROWS_PER_PAGE) {
    pages.push(settled.slice(i, i + ROWS_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const rangeLabel = DATE_RANGE_LABELS[dateRange].replace(' ', '_');
  const generatedAt = format(new Date(), 'yyyy-MM-dd_HH-mm');
  const filename = `sendzz_tx_export_${rangeLabel}_${generatedAt}.pdf`;

  // A4 landscape dimensions in mm
  const PAGE_W_MM = 297;
  const PAGE_H_MM = 210;

  let doc: InstanceType<typeof jsPDF> | null = null;

  for (let p = 0; p < pages.length; p++) {
    const { html, links } = buildTablePage(pages[p], p, logoSrc, dateRange, summary, p === 0);

    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:1100px;';
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
      const pageEl = container.firstElementChild as HTMLElement;
      const pageRect = pageEl.getBoundingClientRect();

      // Collect link positions relative to the rendered page element
      // before capture (DOM is live at this point)
      const linkRects = links.map(({ elementId, url }) => {
        const el = document.getElementById(elementId);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          url,
          // Position relative to the page element, in px
          x: r.left - pageRect.left,
          y: r.top - pageRect.top,
          w: r.width,
          h: r.height,
        };
      }).filter(Boolean) as { url: string; x: number; y: number; w: number; h: number }[];

      const PIXEL_RATIO = 2;

      const dataUrl = await toPng(pageEl, {
        pixelRatio: PIXEL_RATIO,
        backgroundColor: PAGE_BG,
        width: 1100,
      });

      const img = new Image();
      await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = dataUrl; });

      const imgAspect = img.naturalWidth / img.naturalHeight;
      const imgW = PAGE_W_MM;
      const imgH = imgW / imgAspect;
      const yOffset = imgH < PAGE_H_MM ? (PAGE_H_MM - imgH) / 2 : 0;

      if (!doc) {
        doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      } else {
        doc.addPage('a4', 'landscape');
      }

      doc.addImage(dataUrl, 'PNG', 0, yOffset, imgW, imgH);

      // Link coords are in CSS px (1x). Scale to mm accounting for pixelRatio.
      // img.naturalWidth = 1100 * PIXEL_RATIO, but imgW maps to PAGE_W_MM,
      // so 1 CSS px = (PAGE_W_MM / 1100) mm regardless of pixelRatio.
      const scaleX = imgW / 1100;
      const scaleY = imgH / (1100 / imgAspect);

      for (const lr of linkRects) {
        const xMm = lr.x * scaleX;
        const yMm = lr.y * scaleY + yOffset;
        const wMm = lr.w * scaleX;
        const hMm = lr.h * scaleY;
        doc.link(xMm, yMm, wMm, hMm, { url: lr.url });
      }
    } finally {
      document.body.removeChild(container);
    }
  }

  document.head.removeChild(styleEl);
  doc!.save(filename);
}
