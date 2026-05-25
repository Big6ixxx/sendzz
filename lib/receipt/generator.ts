'use client';

import { ReceiptData } from './types';
import { PAGE_BG, receiptBodyMarkup, receiptHTMLPage, FONT_STYLES } from './template';

const LOGO_PATH = '/logo-black.svg';

async function captureReceiptDataUrl(data: ReceiptData): Promise<string> {
  const logoSvgText = await fetch(LOGO_PATH).then((r) => r.text());
  const logoSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvgText)}`;

  // Inject font declarations into <head> so document.fonts picks them up
  const styleEl = document.createElement('style');
  styleEl.textContent = FONT_STYLES;
  document.head.appendChild(styleEl);

  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;width:480px;';
  container.innerHTML = receiptBodyMarkup(data, logoSrc);
  document.body.appendChild(container);

  try {
    const { toPng } = await import('html-to-image');

    // Wait for Geist + Kollektif to finish loading before capture
    if (document.fonts) {
      await document.fonts.ready;
    }

    return await toPng(container.firstElementChild as HTMLElement, {
      pixelRatio: 2,
      backgroundColor: PAGE_BG,
    });
  } finally {
    document.body.removeChild(container);
    document.head.removeChild(styleEl);
  }
}

export async function downloadReceiptPDF(data: ReceiptData): Promise<void> {
  const dataUrl = await captureReceiptDataUrl(data);
  const { jsPDF } = await import('jspdf');

  const img = new Image();
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.src = dataUrl;
  });

  const w = img.naturalWidth / 2;
  const h = img.naturalHeight / 2;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [w, h] });
  doc.addImage(dataUrl, 'PNG', 0, 0, w, h);
  doc.save(`sendzz-receipt-${data.id.slice(0, 8)}.pdf`);
}

export async function downloadReceiptImage(data: ReceiptData): Promise<void> {
  const dataUrl = await captureReceiptDataUrl(data);
  const a = document.createElement('a');
  a.download = `sendzz-receipt-${data.id.slice(0, 8)}.png`;
  a.href = dataUrl;
  a.click();
}

export function printReceipt(data: ReceiptData): void {
  const logoSrc = `${window.location.origin}${LOGO_PATH}`;
  const html = receiptHTMLPage(data, logoSrc);
  const win = window.open('', '_blank', 'width=560,height=960');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
