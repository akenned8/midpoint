// Single venue result with per-person travel times
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
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function timeColor(seconds: number): string {
  const mins = seconds / 60;
  if (mins <= 15) return 'bg-emerald-50 text-emerald-700';
  if (mins <= 25) return 'bg-teal-50 text-teal-700';
  if (mins <= 35) return 'bg-amber-50 text-amber-700';
  if (mins <= 45) return 'bg-orange-50 text-orange-700';
  return 'bg-red-50 text-red-700';
}

function barColor(seconds: number, isMax: boolean): string {
  if (isMax) return 'bg-gradient-to-r from-orange-300 to-orange-400';
  const mins = seconds / 60;
  if (mins <= 20) return 'bg-gradient-to-r from-emerald-300 to-emerald-400';
  if (mins <= 35) return 'bg-gradient-to-r from-amber-300 to-amber-400';
  return 'bg-gradient-to-r from-orange-300 to-orange-400';
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

  return (
    <div
      className={`cursor-pointer rounded-2xl border bg-card p-4 transition-all hover:shadow-md active:scale-[0.99] ${
        isSelected
          ? 'border-primary/30 shadow-md shadow-primary/8 ring-1 ring-primary/20'
          : 'border-border/50 shadow-sm hover:border-border'
      }`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
            rank === 1
              ? 'bg-gradient-to-br from-primary to-primary/80 text-white shadow-sm shadow-primary/20'
              : 'bg-muted text-muted-foreground'
          }`}>
            {rank}
          </span>
          <h3 className="text-[15px] font-semibold leading-tight">{venue.name}</h3>
        </div>
        {venue.rating > 0 && (
          <div className="flex items-center gap-1 text-sm shrink-0">
            <span className="text-amber-400">★</span>
            <span className="font-medium text-foreground/70">{venue.rating.toFixed(1)}</span>
            {venue.reviewCount > 0 && (
              <span className="text-xs text-muted-foreground">({venue.reviewCount.toLocaleString()})</span>
            )}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {venue.priceLevel != null && (
          <span className="inline-flex items-center rounded-lg bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {PRICE_LABELS[venue.priceLevel]}
          </span>
        )}
        {venue.types.slice(0, 2).map((t) => (
          <span key={t} className="inline-flex items-center rounded-lg bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Per-person travel times */}
      {venue.travelTimes.length > 0 && (
        <div className="space-y-2">
          {people.map((person, i) => {
            const time = venue.travelTimes[i];
            if (time == null) return null;
            const isMax = time === maxTime && people.length > 1;
            return (
              <div key={person.id} className="flex items-center gap-2 text-sm">
                <div
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: person.color }}
                />
                <span className="w-14 truncate text-xs text-muted-foreground font-medium">
                  {person.label}
                </span>
                {/* Travel time bar */}
                <div className="flex-1">
                  <div className="h-3.5 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor(time, isMax)}`}
                      style={{
                        width: `${Math.min(100, (time / (maxTime * 1.15)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <span
                  className={`min-w-[3.2rem] rounded-lg px-2 py-0.5 text-center text-xs font-semibold ${timeColor(time)}`}
                >
                  {formatTime(time)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {venue.travelTimes.length > 0 && (
        <div className="flex justify-between mt-3 pt-2.5 border-t border-border/40 text-xs text-muted-foreground">
          <span>Avg: <span className="font-semibold text-foreground/60">{formatTime(avgTime)}</span></span>
          <span>Max: <span className="font-semibold text-foreground/60">{formatTime(maxTime)}</span></span>
        </div>
      )}
    </div>
  );
}
