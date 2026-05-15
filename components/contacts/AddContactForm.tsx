'use client';

import { Loader2, UserPlus, X } from 'lucide-react';

interface AddContactFormProps {
  name: string;
  email: string;
  error: string;
  isPending: boolean;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function AddContactForm({
  name,
  email,
  error,
  isPending,
  onNameChange,
  onEmailChange,
  onSubmit,
  onClose,
}: AddContactFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-8 p-6 bg-white/5 border border-white/10 rounded-2xl relative"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <h3 className="text-sm font-bold tracking-tight text-white mb-4 uppercase">
        New Contact
      </h3>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Satoshi Nakamoto"
            className="w-full h-12 bg-background border border-input rounded-xl px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="satoshi@example.com"
            className="w-full h-12 bg-background border border-input rounded-xl px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
            required
          />
        </div>
        {error && <p className="text-red-400 text-xs font-medium">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full h-12 bg-accent text-accent-foreground font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <UserPlus className="w-4 h-4" />
          )}
          Save Contact
        </button>
      </div>
    </form>
  );
}
