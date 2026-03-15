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
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function timeBadgeStyle(seconds: number): string {
  const mins = seconds / 60;
  if (mins <= 20) return 'text-[#34C759]';
  if (mins <= 35) return 'text-[#FF9500]';
  return 'text-[#FF3B30]';
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
      className={`cursor-pointer rounded-2xl border p-4 transition-all active:scale-[0.99] ${
        isSelected
          ? 'border-[#007AFF]/30 bg-[#007AFF]/[0.03] shadow-sm'
          : 'border-black/[0.06] bg-white hover:border-black/[0.1] hover:shadow-sm'
      }`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            rank === 1
              ? 'bg-[#007AFF] text-white'
              : 'bg-[#F5F5F7] text-[#86868B]'
          }`}>
            {rank}
          </span>
          <h3 className="text-[15px] font-semibold text-[#1D1D1F] leading-snug truncate">{venue.name}</h3>
        </div>
        {venue.rating > 0 && (
          <div className="flex items-center gap-0.5 shrink-0 text-[13px]">
            <span className="text-[#FF9500]">★</span>
            <span className="font-medium text-[#1D1D1F]">{venue.rating.toFixed(1)}</span>
            {venue.reviewCount > 0 && (
              <span className="text-[#86868B] ml-0.5">({venue.reviewCount.toLocaleString()})</span>
            )}
          </div>
        )}
      </div>

      {/* Tags */}
      {(venue.types.length > 0 || venue.priceLevel != null) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {venue.priceLevel != null && (
            <span className="text-[11px] font-medium text-[#86868B] bg-[#F5F5F7] rounded-md px-1.5 py-0.5">
              {PRICE_LABELS[venue.priceLevel]}
            </span>
          )}
          {venue.types.slice(0, 2).map((t) => (
            <span key={t} className="text-[11px] font-medium text-[#86868B] bg-[#F5F5F7] rounded-md px-1.5 py-0.5">
              {t.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Travel times */}
      {venue.travelTimes.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {people.map((person, i) => {
            const time = venue.travelTimes[i];
            if (time == null) return null;
            const isMax = time === maxTime && people.length > 1;
            return (
              <div key={person.id} className="flex items-center gap-2">
                <div
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: person.color }}
                />
                <span className="w-14 truncate text-[12px] text-[#86868B]">
                  {person.label}
                </span>
                <div className="flex-1 h-[6px] rounded-full bg-[#F5F5F7] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isMax ? 'bg-[#FF9500]' : 'bg-[#007AFF]'
                    }`}
                    style={{ width: `${Math.min(100, (time / (maxTime * 1.15)) * 100)}%`, opacity: isMax ? 1 : 0.6 }}
                  />
                </div>
                <span className={`text-[12px] font-medium tabular-nums min-w-[3rem] text-right ${timeBadgeStyle(time)}`}>
                  {formatTime(time)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {venue.travelTimes.length > 0 && (
        <div className="flex justify-between mt-3 pt-2 border-t border-black/[0.04] text-[11px] text-[#86868B]">
          <span>Avg <span className="font-medium text-[#1D1D1F]">{formatTime(avgTime)}</span></span>
          <span>Max <span className="font-medium text-[#1D1D1F]">{formatTime(maxTime)}</span></span>
        </div>
      )}
    </div>
  );
}
