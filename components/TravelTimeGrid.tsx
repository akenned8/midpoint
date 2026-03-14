// N×M matrix of people × venues, color-coded
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
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}m` : `${hrs}h`;
}

function cellColor(seconds: number): string {
  const mins = seconds / 60;
  if (mins <= 15) return 'bg-green-100 text-green-900';
  if (mins <= 25) return 'bg-emerald-100 text-emerald-900';
  if (mins <= 35) return 'bg-yellow-100 text-yellow-900';
  if (mins <= 45) return 'bg-orange-100 text-orange-900';
  return 'bg-red-100 text-red-900';
}

export default function TravelTimeGrid({
  people,
  venues,
  selectedVenueId,
  onSelectVenue,
}: TravelTimeGridProps) {
  if (venues.length === 0 || people.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-2 text-left text-xs font-medium text-muted-foreground">
              Venue
            </th>
            {people.map((p) => (
              <th key={p.id} className="p-2 text-center text-xs font-medium">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="max-w-[4rem] truncate">{p.label}</span>
                </div>
              </th>
            ))}
            <th className="p-2 text-center text-xs font-medium text-muted-foreground">
              Max
            </th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => {
            const maxTime =
              venue.travelTimes.length > 0
                ? Math.max(...venue.travelTimes)
                : 0;
            const isSelected = venue.placeId === selectedVenueId;

            return (
              <tr
                key={venue.placeId}
                className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
                onClick={() => onSelectVenue(venue.placeId)}
              >
                <td className="max-w-[8rem] truncate p-2 font-medium">
                  {venue.name}
                </td>
                {people.map((person, i) => {
                  const time = venue.travelTimes[i];
                  if (time == null) {
                    return (
                      <td key={person.id} className="p-1 text-center text-xs text-muted-foreground">
                        —
                      </td>
                    );
                  }
                  const isMax = time === maxTime && people.length > 1;
                  return (
                    <td key={person.id} className="p-1 text-center">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cellColor(time)} ${
                          isMax ? 'ring-1 ring-orange-400' : ''
                        }`}
                      >
                        {formatTime(time)}
                      </span>
                    </td>
                  );
                })}
                <td className="p-1 text-center text-xs font-medium text-muted-foreground">
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
