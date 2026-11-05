'use client';

import { cn } from '@/lib/utils';
import { downloadReceiptImage, downloadReceiptPDF, printReceipt } from '@/lib/receipt/generator';
import { ReceiptData } from '@/lib/receipt/types';
import { Download, FileImage, Loader2, Printer } from 'lucide-react';
import { useState } from 'react';

interface ReceiptActionsProps {
  data: ReceiptData;
  className?: string;
  /** `cream`: rounded pills for the cream brand screens. Only the buttons change, never the receipt. */
}

export function ReceiptActions({ data, className }: ReceiptActionsProps) {
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingImg, setLoadingImg] = useState(false);

  const cls =
    'flex-1 h-11 rounded-full flex items-center justify-center gap-2 bg-[var(--lp-surface)] text-[14px] font-semibold text-[var(--lp-ink)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.12)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.4)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--lp-ink)] disabled:opacity-50';

  const handlePDF = async () => {
    setLoadingPdf(true);
    try {
      await downloadReceiptPDF(data);
    } finally {
      setLoadingPdf(false);
    }
  };

  const handleImage = async () => {
    setLoadingImg(true);
    try {
      await downloadReceiptImage(data);
    } finally {
      setLoadingImg(false);
    }
  };

  return (
    <div className={cn('flex gap-2', className)}>
      <button onClick={handlePDF} disabled={loadingPdf} className={cls} title="Download PDF">
        {loadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        PDF
      </button>
      <button onClick={handleImage} disabled={loadingImg} className={cls} title="Download Image">
        {loadingImg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileImage className="w-3.5 h-3.5" />}
        Image
      </button>
      <button onClick={() => printReceipt(data)} className={cls} title="Print receipt">
        <Printer className="w-3.5 h-3.5" />
        Print
      </button>
    </div>
  );
}
