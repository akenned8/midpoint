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
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}m` : `${hrs}h`;
}

function cellStyle(seconds: number): string {
  const mins = seconds / 60;
  if (mins <= 20) return 'text-[#34C759] bg-[#34C759]/8';
  if (mins <= 35) return 'text-[#FF9500] bg-[#FF9500]/8';
  return 'text-[#FF3B30] bg-[#FF3B30]/8';
}

export default function TravelTimeGrid({
  people,
  venues,
  selectedVenueId,
  onSelectVenue,
}: TravelTimeGridProps) {
  if (venues.length === 0 || people.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-black/[0.06] bg-white">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-black/[0.04]">
            <th className="p-2.5 text-left text-[11px] font-medium text-[#86868B]">Venue</th>
            {people.map((p) => (
              <th key={p.id} className="p-2.5 text-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-[11px] font-medium text-[#86868B] max-w-[3.5rem] truncate">{p.label}</span>
                </div>
              </th>
            ))}
            <th className="p-2.5 text-center text-[11px] font-medium text-[#86868B]">Max</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => {
            const maxTime = venue.travelTimes.length > 0 ? Math.max(...venue.travelTimes) : 0;
            const isSelected = venue.placeId === selectedVenueId;
            return (
              <tr
                key={venue.placeId}
                className={`cursor-pointer border-b border-black/[0.03] transition-colors hover:bg-[#F5F5F7]/60 ${
                  isSelected ? 'bg-[#007AFF]/[0.04]' : ''
                }`}
                onClick={() => onSelectVenue(venue.placeId)}
              >
                <td className="max-w-[7rem] truncate p-2.5 font-medium text-[#1D1D1F]">{venue.name}</td>
                {people.map((person, i) => {
                  const time = venue.travelTimes[i];
                  if (time == null) return <td key={person.id} className="p-1.5 text-center text-[#86868B]">—</td>;
                  return (
                    <td key={person.id} className="p-1.5 text-center">
                      <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${cellStyle(time)}`}>
                        {formatTime(time)}
                      </span>
                    </td>
                  );
                })}
                <td className="p-1.5 text-center text-[11px] font-semibold text-[#86868B] tabular-nums">
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
