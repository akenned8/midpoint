// N×M matrix of people × venues
'use client';

import type { Person, Venue } from '@/types';

interface TravelTimeGridProps {
  people: Person[];
  venues: Venue[];
  selectedVenueId: string | null;
  onSelectVenue: (id: string) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}′`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}` : `${hrs}h`;
}

function cellColor(seconds: number): string {
  const mins = seconds / 60;
  if (mins <= 20) return 'text-[var(--good)]';
  if (mins <= 35) return 'text-[var(--warn)]';
  return 'text-[var(--hot)]';
}

export default function TravelTimeGrid({
  people,
  venues,
  selectedVenueId,
  onSelectVenue,
}: TravelTimeGridProps) {
  if (venues.length === 0 || people.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--card)]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--rule)] bg-[var(--paper-deep)]/40">
            <th className="px-2.5 py-2 text-left font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Spot</th>
            {people.map((p) => (
              <th key={p.id} className="px-2 py-2 text-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ink-muted)] max-w-[3rem] truncate">{p.label}</span>
                </div>
              </th>
            ))}
            <th className="px-2 py-2 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Max</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => {
            const maxTime = venue.travelTimes.length > 0 ? Math.max(...venue.travelTimes) : 0;
            const isSelected = venue.placeId === selectedVenueId;
            return (
              <tr
                key={venue.placeId}
                className={`cursor-pointer border-b border-[var(--rule)]/60 last:border-b-0 transition-colors ${
                  isSelected ? 'bg-[var(--ink)]/[0.04]' : 'hover:bg-[var(--paper-deep)]/30'
                }`}
                onClick={() => onSelectVenue(venue.placeId)}
              >
                <td className="max-w-[8rem] truncate px-2.5 py-2 font-display text-[13px] text-[var(--ink)]" style={{ fontVariationSettings: '"opsz" 144' }}>{venue.name}</td>
                {people.map((person, i) => {
                  const time = venue.travelTimes[i];
                  if (time == null) return <td key={person.id} className="px-1.5 py-2 text-center text-[var(--ink-muted)]">—</td>;
                  return (
                    <td key={person.id} className="px-1.5 py-2 text-center">
                      <span className={`font-mono text-[11px] font-semibold tnum ${cellColor(time)}`}>
                        {formatTime(time)}
                      </span>
                    </td>
                  );
                })}
                <td className="px-1.5 py-2 text-center font-mono text-[11px] font-semibold text-[var(--ink)] tnum">
                  {maxTime > 0 ? formatTime(maxTime) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
