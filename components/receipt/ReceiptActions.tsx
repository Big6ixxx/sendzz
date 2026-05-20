'use client';

import { cn } from '@/lib/utils';
import { downloadReceiptImage, downloadReceiptPDF, printReceipt } from '@/lib/receipt/generator';
import { ReceiptData } from '@/lib/receipt/types';
import { Download, FileImage, Loader2, Printer } from 'lucide-react';
import { useState } from 'react';

interface ReceiptActionsProps {
  data: ReceiptData;
  className?: string;
  variant?: 'dark' | 'light';
}

export function ReceiptActions({ data, className, variant = 'dark' }: ReceiptActionsProps) {
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingImg, setLoadingImg] = useState(false);

  const base =
    'flex-1 h-10 rounded-xl flex items-center justify-center gap-1.5 font-bold text-[10px] uppercase tracking-widest transition-all outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50';

  const dark = 'bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10';
  const light = 'bg-muted text-foreground border border-border hover:bg-muted/60';

  const cls = cn(base, variant === 'dark' ? dark : light);

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
