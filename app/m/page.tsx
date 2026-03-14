// Shared link entry point — reads URL state and renders results
'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { decodeState } from '@/lib/url-state';
import VenueCard from '@/components/VenueCard';
import TravelTimeGrid from '@/components/TravelTimeGrid';
import type { SessionState, Venue } from '@/types';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

function SharedContent() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<SessionState | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const encoded = searchParams.get('s');
    if (!encoded) {
      setError('No session data in URL');
      setIsLoading(false);
      return;
    }

    const decoded = decodeState(encoded);
    if (!decoded) {
      setError('Invalid session data');
      setIsLoading(false);
      return;
    }

    setState(decoded);

    // Re-run optimization
    fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        people: decoded.people,
        objective: decoded.objective,
        alpha: decoded.alpha,
        departureTime: decoded.departureTime,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setVenues(data.venues ?? []);
        }
      })
      .catch(() => {
        setError('Failed to load results');
      })
      .finally(() => setIsLoading(false));
  }, [searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">meetmidpoint</h1>
          <p className="mt-2 text-muted-foreground">{error}</p>
          <a href="/" className="mt-4 inline-block text-primary underline">
            Start a new search
          </a>
        </div>
      </div>
    );
  }

  if (isLoading || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">meetmidpoint</h1>
          <p className="mt-2 animate-pulse text-muted-foreground">Loading shared session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="flex w-full flex-col gap-4 overflow-y-auto border-r p-4 lg:w-[420px] lg:shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">meetmidpoint</h1>
          <a href="/" className="text-sm text-primary underline">
            New search
          </a>
        </div>

        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">
            {state.people.length} people ·{' '}
            {state.departureTime === 'now'
              ? 'Departing now'
              : `Departing ${new Date(state.departureTime).toLocaleString()}`}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {state.people.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                {p.label} ({p.mode})
              </span>
            ))}
          </div>
        </div>

        {venues.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Results</h2>
            {venues.slice(0, 5).map((venue, i) => (
              <VenueCard
                key={venue.placeId}
                venue={venue}
                people={state.people}
                rank={i + 1}
                isSelected={venue.placeId === selectedVenueId}
                onClick={() => setSelectedVenueId(venue.placeId)}
              />
            ))}

            {venues.length > 5 && (
              <TravelTimeGrid
                people={state.people}
                venues={venues}
                selectedVenueId={selectedVenueId}
                onSelectVenue={setSelectedVenueId}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex-1">
        <Map
          people={state.people}
          venues={venues}
          isochrones={null}
          selectedVenueId={selectedVenueId}
        />
      </div>
    </div>
  );
}

export default function SharedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="animate-pulse text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <SharedContent />
    </Suspense>
  );
}
