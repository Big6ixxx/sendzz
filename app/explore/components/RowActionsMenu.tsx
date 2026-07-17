'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PublicFeedRow } from '@/types/public';
import { Eye, Share2 } from 'lucide-react';

interface RowActionsMenuProps {
  /** The row the menu currently targets, or null when closed. */
  row: PublicFeedRow | null;
  /** The kebab button the menu is anchored to (also refocused on close). */
  anchorEl: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onView: (row: PublicFeedRow) => void;
  onShare: (row: PublicFeedRow) => void;
}

/**
 * A SINGLE actions menu shared by every row. Each row's kebab button reports itself as the
 * anchor; this one instance repositions to it and its actions target the selected row — so we
 * never mount one menu per row. Anchored via a fixed, zero-size element at the kebab's position.
 */
export function RowActionsMenu({ row, anchorEl, onOpenChange, onView, onShare }: RowActionsMenuProps) {
  const open = !!row && !!anchorEl;
  const rect = anchorEl?.getBoundingClientRect();

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            top: rect ? rect.bottom : 0,
            left: rect ? rect.right : 0,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(e) => {
          // Return focus to the kebab that opened the menu (keyboard accessibility).
          e.preventDefault();
          anchorEl?.focus();
        }}
      >
        <DropdownMenuItem
          onSelect={() => row && onView(row)}
          className="gap-2.5 rounded-lg px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-white/80 focus:bg-white/5 focus:text-accent cursor-pointer"
        >
          <Eye className="w-4 h-4" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => row && onShare(row)}
          className="gap-2.5 rounded-lg px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-white/80 focus:bg-white/5 focus:text-accent cursor-pointer"
        >
          <Share2 className="w-4 h-4" /> Share
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
