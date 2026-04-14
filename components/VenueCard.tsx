// Single venue result with per-person travel times — editorial layout
'use client';

import type { Venue, Person } from '@/types';

interface VenueCardProps {
  venue: Venue;
  people: Person[];
  rank: number;
  isSelected: boolean;
  onClick: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}′`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}` : `${hrs}h`;
}

function timeColor(seconds: number): string {
  const mins = seconds / 60;
  if (mins <= 20) return 'text-[var(--good)]';
  if (mins <= 35) return 'text-[var(--warn)]';
  return 'text-[var(--hot)]';
}

const PRICE_LABELS = ['Free', '$', '$$', '$$$', '$$$$'];

export default function VenueCard({
  venue,
  people,
  rank,
  isSelected,
  onClick,
}: VenueCardProps) {
  const maxTime = venue.travelTimes.length > 0 ? Math.max(...venue.travelTimes) : 0;
  const avgTime =
    venue.travelTimes.length > 0
      ? venue.travelTimes.reduce((a, b) => a + b, 0) / venue.travelTimes.length
      : 0;
  const spread = maxTime > 0 && venue.travelTimes.length > 1
    ? maxTime - Math.min(...venue.travelTimes)
    : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full text-left rounded-md border bg-[var(--card)] transition-all overflow-hidden active:scale-[0.995] ${
        isSelected
          ? 'border-[var(--ink)] shadow-[0_2px_0_0_var(--ink)]'
          : 'border-[var(--rule)] hover:border-[var(--ink-soft)]'
      }`}
    >
      {/* Top: rank gutter + content */}
      <div className="flex">
        {/* Rank gutter */}
        <div className={`relative w-[68px] shrink-0 border-r ${
          isSelected ? 'border-[var(--ink)] bg-[var(--ink)]' : 'border-[var(--rule)] bg-[var(--paper-deep)]'
        }`}>
          <div className="flex h-full flex-col items-center justify-center py-4">
            <span className={`font-display text-[44px] leading-none ${
              isSelected ? 'text-[var(--paper)]' : 'text-[var(--ink)]'
            }`}
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
            >
              {rank}
            </span>
            <span className={`mt-1 font-mono text-[8px] tracking-[0.18em] uppercase ${
              isSelected ? 'text-[var(--paper)]/60' : 'text-[var(--ink-muted)]'
            }`}>
              {rank === 1 ? 'Best' : 'Rank'}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 p-3.5">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-[19px] leading-[1.15] text-[var(--ink)] truncate"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}
            >
              {venue.name}
            </h3>
            {venue.rating > 0 && (
              <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--warn)]">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span className="font-mono text-[11px] font-semibold tnum text-[var(--ink)]">{venue.rating.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* Meta row: neighborhood + tags */}
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--ink-muted)]">
            {venue.neighborhood && <span>{venue.neighborhood}</span>}
            {venue.priceLevel != null && (
              <>
                <span className="text-[var(--rule)]">·</span>
                <span>{PRICE_LABELS[venue.priceLevel]}</span>
              </>
            )}
            {venue.types[0] && (
              <>
                <span className="text-[var(--rule)]">·</span>
                <span className="truncate">{venue.types[0].replace(/_/g, ' ')}</span>
              </>
            )}
          </div>

          {/* Per-person time chips */}
          {venue.travelTimes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {people.map((person, i) => {
                const time = venue.travelTimes[i];
                if (time == null) return null;
                const isMax = time === maxTime && people.length > 1;
                return (
                  <div
                    key={person.id}
                    className={`flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 ${
                      isMax ? 'border-[var(--hot)]/40 bg-[var(--hot)]/[0.06]' : 'border-[var(--rule)] bg-[var(--paper)]'
                    }`}
                  >
                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: person.color }} />
                    <span className="text-[10px] font-medium text-[var(--ink-soft)] max-w-[3.5rem] truncate">
                      {person.label}
                    </span>
                    <span className={`font-mono text-[11px] font-semibold tnum ${timeColor(time)}`}>
                      {formatTime(time)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer stats — editorial rule */}
      {venue.travelTimes.length > 0 && (
        <div className="flex items-center justify-between border-t border-dashed border-[var(--rule)] bg-[var(--paper-deep)]/50 px-3.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--ink-muted)]">
          <span>
            Avg <span className="font-semibold text-[var(--ink)] tnum">{formatTime(avgTime)}</span>
          </span>
          <span>
            Max <span className="font-semibold text-[var(--ink)] tnum">{formatTime(maxTime)}</span>
          </span>
          {spread > 0 && (
            <span>
              Δ <span className="font-semibold text-[var(--ink)] tnum">{formatTime(spread)}</span>
            </span>
          )}
        </div>
      )}
    </button>
  );
}
