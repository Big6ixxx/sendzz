import type { ReceiptData } from './types';

export const PAGE_BG = '#EFF8E9';

const MONO_LABELS = new Set(['reference id', 'blockchain tx', 'order id', 'tx hash']);

function isSuccess(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'completed' || s === 'settled' || s === 'confirmed' || s === 'success' || s === 'complete';
}

function formatReceiptDate(iso: string): string {
  const dt = new Date(iso);
  const day = dt.getDate();
  const month = dt.toLocaleString('en-US', { month: 'short' });
  const year = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

function buildRows(data: ReceiptData): [string, string][] {
  const shortId = '#' + data.id.slice(0, 8).toUpperCase();
  const rows: [string, string][] = [
    ['Reference ID', data.id.toUpperCase()],
    ['Transaction Receipt', shortId],
  ];
  if (data.senderEmail) rows.push(['From', data.senderEmail]);
  if (data.recipientEmail) rows.push(['To', data.recipientEmail]);
  if (data.note) rows.push(['Memo', data.note]);
  if (data.fiatAmount != null && data.fiatCurrency)
    rows.push(['Fiat Amount', `${data.fiatAmount.toLocaleString()} ${data.fiatCurrency}`]);
  if (data.fiatPayoutAmount != null && data.fiatCurrency)
    rows.push(['Payout Amount', `${data.fiatPayoutAmount.toLocaleString()} ${data.fiatCurrency}`]);
  if (data.exchangeRate != null && data.fiatCurrency)
    rows.push(['Exchange Rate', `1 USDC = ${data.exchangeRate.toLocaleString()} ${data.fiatCurrency}`]);
  if (data.bankName) rows.push(['Bank', data.bankName]);
  if (data.bankAccount) rows.push(['Account', data.bankAccount]);
  if (data.sourceChain) rows.push(['Source Chain', data.sourceChain.toUpperCase()]);
  if (data.destChain) rows.push(['Dest Chain', data.destChain.toUpperCase()]);
  if (data.txHash) rows.push(['Blockchain TX', data.txHash]);
  if (data.orderId) rows.push(['Order ID', data.orderId]);
  return rows;
}

/**
 * Inner visual markup for the receipt — used both by printReceipt (in a full HTML page)
 * and captureReceiptCanvas (rendered via html2canvas).
 *
 * @param illustrationSrc  URL or data-URI for the bottom illustration image.
 */
export function receiptBodyMarkup(data: ReceiptData, illustrationSrc: string, logoSrc: string): string {
  const ok = isSuccess(data.status);
  const statusText = data.status.toUpperCase();
  // Solid filled badge: green for success, amber for pending, red for failed
  const badgeBg = ok ? '#00e87a' : (data.status.toLowerCase() === 'failed' || data.status.toLowerCase() === 'expired' ? '#991b1b' : '#92400e');
  const dateStr = formatReceiptDate(data.timestamp);
  const rows = buildRows(data);
  const amountStr = data.amountUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  const rowsHtml = rows
    .map(([label, value], i) => {
      const isMono = MONO_LABELS.has(label.toLowerCase());
      return `<div style="padding:14px 0;display:flex;justify-content:space-between;align-items:flex-start;${i < rows.length - 1 ? 'border-bottom:1px dashed #d8d8d8;' : ''}">
        <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.14em;color:#ababab;flex-shrink:0;width:130px;padding-top:3px;line-height:1.5;font-family:'Geist',sans-serif;">${label}</div>
        <div style="font-size:${isMono ? '10px' : '13px'};font-weight:700;color:#1a1a1a;text-align:right;flex:1;word-break:break-all;font-family:${isMono ? "'JetBrains Mono','Courier New',monospace" : "'Geist',sans-serif"};">${value}</div>
      </div>`;
    })
    .join('');

  // Card has 32px margin on each side → card width = 480 - 64 = 416px
  // Scallop SVG matches that exact width and is offset by the same margin.
  const CARD_MARGIN = 32;
  const cardWidth = 480 - CARD_MARGIN * 2;
  const numCircles = Math.ceil(cardWidth / 20);
  const circles = Array.from({ length: numCircles }, (_, i) => `<circle cx="${i * 20 + 10}" cy="0" r="10" fill="#DDEAF8" />`).join('');
  const scallopDiv = `<svg width="${cardWidth}" height="10" viewBox="0 0 ${cardWidth} 10" style="display:block;margin-left:${CARD_MARGIN}px;margin-top:-1px;" xmlns="http://www.w3.org/2000/svg"><rect width="${cardWidth}" height="10" fill="${PAGE_BG}"/>${circles}</svg>`;

  return `<div style="background:${PAGE_BG};width:480px;padding-top:32px;font-family:'Geist',-apple-system,BlinkMacSystemFont,sans-serif;color:#1a1a1a;">

  <div style="background:#ffffff;margin:0 ${CARD_MARGIN}px;border-radius:16px 16px 0 0;box-shadow:0 2px 20px rgba(0,0,0,0.07);">

    <div style="padding:22px 28px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;">
        <img src="${logoSrc}" width="52" alt="" />
      </div>
      <div style="display:inline-flex;align-items:center;padding:7px 18px;border-radius:999px;background:${badgeBg};white-space:nowrap;">
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#ffffff;font-family:'Geist',sans-serif;">${statusText}</span>
      </div>
    </div>

    <div style="padding:8px 28px 32px;text-align:center;">
      <div style="font-size:48px;font-weight:700;letter-spacing:-0.04em;color:#111111;line-height:1.05;font-family:'Kollektif',sans-serif;">
        $${amountStr} USDC
      </div>
      <div style="font-size:13px;color:#999999;margin-top:10px;font-weight:500;font-family:'Geist',sans-serif;">on ${dateStr}</div>
    </div>

    <div style="height:1px;background:#ececec;margin:0 28px;"></div>

    <div style="padding:0 28px;">${rowsHtml}</div>

    <div style="height:20px;"></div>
  </div>

  ${scallopDiv}

  <div style="padding:24px 48px 16px;text-align:center;">
    <p style="font-size:14px;color:#2c7a18;font-weight:600;line-height:1.8;margin:0;font-family:'Geist',sans-serif;">
      Its secured to your email and ready for your bank.<br>
      No codes or waiting<br>
      Click above to get your money now
    </p>
  </div>

  <div style="line-height:0;font-size:0;">
    <img src="${illustrationSrc}" width="480" style="display:block;width:100%;height:auto;" alt="">
  </div>

</div>`;
}

export const FONT_STYLES = `
  @import url('https://fonts.cdnfonts.com/css/kollektif');
  @font-face {
    font-family: 'Geist';
    src: url('https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: 'Geist';
    src: url('https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/Geist-Medium.woff2') format('woff2');
    font-weight: 500;
    font-style: normal;
  }
  @font-face {
    font-family: 'Geist';
    src: url('https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');
    font-weight: 600;
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
`;

/**
 * Complete HTML document for the print window.
 * Loads Kollektif and Geist from CDN, waits for document.fonts.ready before printing.
 */
export function receiptHTMLPage(data: ReceiptData, illustrationSrc: string, logoSrc: string): string {
  const body = receiptBodyMarkup(data, illustrationSrc, logoSrc);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Sendzz Receipt</title>
  <style>
    ${FONT_STYLES}
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${PAGE_BG};
      display: flex;
      justify-content: center;
      padding: 32px;
      font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { background: ${PAGE_BG} !important; padding: 0 !important; }
      @page { margin: 0; size: 480px auto; }
    }
  </style>
</head>
<body>
  ${body}
  <script>
    document.fonts.ready.then(function() {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`;
}
