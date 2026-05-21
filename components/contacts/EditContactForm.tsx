'use client';

import { Check, Loader2, X } from 'lucide-react';

interface EditContactFormProps {
  name: string;
  email: string;
  isPending: boolean;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function EditContactForm({
  name,
  email,
  isPending,
  onNameChange,
  onEmailChange,
  onSubmit,
  onCancel,
}: EditContactFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="p-4 rounded-2xl bg-white/4 border border-accent/20 flex flex-col md:flex-row items-start md:items-center gap-4 transition-colors"
    >
      <div className="flex-1 space-y-3 w-full">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Name"
          className="w-full h-10 bg-background border border-input rounded-xl px-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent/50"
          required
        />
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="Email"
          className="w-full h-10 bg-background border border-input rounded-xl px-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent/50"
          required
        />
      </div>
      <div className="flex items-center gap-2 w-full md:w-auto justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="p-2 text-white/40 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          Save
        </button>
      </div>
    </form>
  );
}
