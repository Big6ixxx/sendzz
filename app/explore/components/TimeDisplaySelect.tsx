'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Globe } from 'lucide-react';
import { ALL_TIMEZONES } from '../useTimeDisplay';

interface TimeDisplaySelectProps {
  value: string;
  onValueChange: (v: string) => void;
  localTimeZone: string;
  abbrev: string;
}

/**
 * Unified time-display picker: "Relative time" on top, then "Local — <zone>" and every IANA
 * timezone. Controls how all timestamps on the page render.
 *
 * Globe + value are kept as *direct* children of the trigger (a flex row) so they stay on one
 * line; the value span grows (`flex-1`) so the chevron stays pinned right.
 */
export function TimeDisplaySelect({
  value,
  onValueChange,
  localTimeZone,
  abbrev,
}: TimeDisplaySelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="Time display"
        className="lg:w-[17rem] [&>span]:flex-1 [&>span]:text-left"
      >
        <Globe className="size-4 shrink-0 text-[var(--lp-muted)]" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="relative">Relative time</SelectItem>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Timezone</SelectLabel>
          <SelectItem value="local">
            Local ({localTimeZone})
            {abbrev ? ` (${abbrev})` : ''}
          </SelectItem>
          {ALL_TIMEZONES.map((tz) => (
            <SelectItem key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
