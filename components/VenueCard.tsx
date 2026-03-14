// Single venue result with per-person travel times
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  if (mins <= 15) return 'bg-green-100 text-green-800';
  if (mins <= 25) return 'bg-emerald-100 text-emerald-800';
  if (mins <= 35) return 'bg-yellow-100 text-yellow-800';
  if (mins <= 45) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
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
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-primary' : ''
      }`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {rank}
            </span>
            <CardTitle className="text-base">{venue.name}</CardTitle>
          </div>
          {venue.rating > 0 && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span className="text-amber-500">★</span>
              <span>{venue.rating.toFixed(1)}</span>
              {venue.reviewCount > 0 && (
                <span className="text-xs">({venue.reviewCount})</span>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Venue metadata */}
        <div className="flex flex-wrap gap-1">
          {venue.priceLevel != null && (
            <Badge variant="outline" className="text-xs">
              {PRICE_LABELS[venue.priceLevel]}
            </Badge>
          )}
          {venue.neighborhood && (
            <Badge variant="secondary" className="text-xs">
              {venue.neighborhood}
            </Badge>
          )}
          {venue.types.slice(0, 2).map((t) => (
            <Badge key={t} variant="secondary" className="text-xs">
              {t.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>

        {/* Per-person travel times */}
        {venue.travelTimes.length > 0 && (
          <div className="space-y-1.5">
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
                  <span className="w-16 truncate text-xs text-muted-foreground">
                    {person.label}
                  </span>
                  {/* Travel time bar */}
                  <div className="flex-1">
                    <div className="h-4 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isMax ? 'bg-orange-400' : 'bg-primary/70'
                        }`}
                        style={{
                          width: `${Math.min(100, (time / (maxTime * 1.1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`min-w-[3rem] justify-center text-xs ${timeColor(time)}`}
                  >
                    {formatTime(time)}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary row */}
        {venue.travelTimes.length > 0 && (
          <div className="flex justify-between border-t pt-2 text-xs text-muted-foreground">
            <span>Avg: {formatTime(avgTime)}</span>
            <span>Max: {formatTime(maxTime)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
