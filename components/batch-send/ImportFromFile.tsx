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
        className="w-full p-4 rounded-2xl border border-border bg-muted/30 hover:bg-muted/50 transition-all flex items-center gap-4 group"
      >
        <div className="w-12 h-12 bg-background rounded-xl border border-border flex items-center justify-center group-hover:shadow-sm transition-all">
          <Upload className="w-5 h-5" />
        </div>
        <div className="flex-1 text-left">
          <p className="font-bold text-sm">Import from File</p>
          <p className="text-[10px] text-muted-foreground uppercase font-bold">
            CSV or TXT supported
          </p>
        </div>
        <FileText className="w-5 h-5 opacity-20" />
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
