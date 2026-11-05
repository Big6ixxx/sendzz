import * as React from 'react';
import { FileText, Upload } from 'lucide-react';

interface ImportFromFileProps {
  onFileSelected: (file: File) => void;
}

export function ImportFromFile({ onFileSelected }: ImportFromFileProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      onFileSelected(f);
    }
    e.target.value = '';
  };

  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="lp-card flex w-full items-center gap-3 rounded-[22px] p-4 text-left transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.2)]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-cream)]">
          <Upload className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Import from a file</span>
          <span className="block text-[13px] text-[var(--lp-muted)]">A CSV or text file with one email per line</span>
        </span>
        <FileText className="size-5 shrink-0 opacity-30" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}
