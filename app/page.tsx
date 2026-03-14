// Main app shell
'use client';

import { useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import PersonInput from '@/components/PersonInput';
import VenueCard from '@/components/VenueCard';
import TravelTimeGrid from '@/components/TravelTimeGrid';
import ObjectiveSlider from '@/components/ObjectiveSlider';
import DepartureTimePicker from '@/components/DepartureTimePicker';
import { encodeState } from '@/lib/url-state';
import { detectOutlier } from '@/lib/scoring';
import type { Person, Venue, SessionState, TravelTimeResult } from '@/types';
import type { RouteFeature } from '@/components/Map';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

const PERSON_COLORS = ['#E8573D', '#7C5CFC', '#3AAFB9', '#F5A623', '#E84393', '#34D399'];

function createPerson(index: number): Person {
  return {
    id: crypto.randomUUID(),
    label: `Person ${index + 1}`,
    lat: 0,
    lng: 0,
    mode: 'transit',
    color: PERSON_COLORS[index % PERSON_COLORS.length],
  };
}

interface CandidateDetail {
  hotspotId: string;
  neighborhood: string;
  borough: string;
  lat: number;
  lng: number;
}

const STAGE_LABELS: Record<string, string> = {
  prefilter: 'Analyzing locations...',
  travel_times: 'Calculating travel times...',
  scoring: 'Scoring candidates...',
  venues: 'Finding nearby spots...',
  done: 'Done!',
};

export default function Home() {
  const [people, setPeople] = useState<Person[]>([createPerson(0), createPerson(1)]);
  const [alpha, setAlpha] = useState(0.7);
  const [departureTime, setDepartureTime] = useState('now');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [rankings, setRankings] = useState<TravelTimeResult[]>([]);
  const [candidateDetails, setCandidateDetails] = useState<CandidateDetail[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteFeature[]>([]);
  const [isochrones, setIsochrones] = useState<GeoJSON.FeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [loadingDetail, setLoadingDetail] = useState('');
  const [outlierIndex, setOutlierIndex] = useState<number | null>(null);
  const [usedHeuristic, setUsedHeuristic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const addPerson = () => {
    if (people.length >= 6) return;
    setPeople([...people, createPerson(people.length)]);
  };

  const updatePerson = (index: number, person: Person) => {
    const updated = [...people];
    updated[index] = person;
    setPeople(updated);
  };

  const removePerson = (index: number) => {
    if (people.length <= 2) return;
    setPeople(people.filter((_, i) => i !== index));
  };

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      const emptyIdx = people.findIndex((p) => p.lat === 0 && p.lng === 0);
      if (emptyIdx >= 0) {
        const updated = [...people];
        updated[emptyIdx] = { ...updated[emptyIdx], lat, lng };
        setPeople(updated);
      }
    },
    [people]
  );

  const findMidpoint = async () => {
    const validPeople = people.filter((p) => p.lat !== 0 && p.lng !== 0);
    if (validPeople.length < 2) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setLoadingStage('prefilter');
    setLoadingDetail('Starting...');
    setOutlierIndex(null);
    setError(null);
    setVenues([]);
    setRankings([]);
    setCandidateDetails([]);
    setRoutes([]);
    setIsochrones(null);

    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          people: validPeople,
          objective: alpha >= 0.8 ? 'fairness' : alpha <= 0.2 ? 'efficiency' : 'blended',
          alpha,
          departureTime,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setError('Optimization failed');
        setIsLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError('No response stream');
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const match = line.match(/^data: (.+)$/);
          if (!match) continue;

          try {
            const msg = JSON.parse(match[1]);

            if (msg.type === 'stage') {
              setLoadingStage(msg.stage);
              setLoadingDetail(STAGE_LABELS[msg.stage] ?? msg.detail ?? '');
            }

            if (msg.type === 'result') {
              const r = msg.rankings as TravelTimeResult[];
              const v = msg.venues as Venue[];
              const cd = msg.candidateDetails as CandidateDetail[];

              setRankings(r);
              setVenues(v);
              setCandidateDetails(cd);
              setUsedHeuristic(msg.usedHeuristic ?? false);

              if (r?.[0]?.times) {
                setOutlierIndex(detectOutlier(r[0].times));
              }

              const topVenue = v?.[0];
              const topCandidate = cd.find((c) => c.hotspotId === r?.[0]?.hotspotId);
              const routeDest = topVenue ?? topCandidate;
              if (routeDest) {
                if (topVenue) setSelectedVenueId(topVenue.placeId);
                else if (topCandidate) setSelectedVenueId(topCandidate.hotspotId);
                fetchRoutes(validPeople, routeDest, departureTime);

                const nonTransit = validPeople.find((p) => p.mode !== 'transit');
                if (nonTransit) {
                  fetch('/api/isochrones', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      lat: routeDest.lat,
                      lng: routeDest.lng,
                      mode: nonTransit.mode === 'transit' ? 'driving' : nonTransit.mode,
                      contours_minutes: [10, 20, 30],
                    }),
                  }).then(async (isoRes) => {
                    if (isoRes.ok && isoRes.status !== 204) {
                      setIsochrones(await isoRes.json());
                    }
                  }).catch(() => {});
                }
              }
            }

            if (msg.type === 'error') {
              setError(msg.error);
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Optimize error:', err);
        setError('Request failed');
      }
    } finally {
      setIsLoading(false);
      setLoadingStage('done');
    }
  };

  const fetchRoutes = async (
    ppl: Person[],
    dest: { lat: number; lng: number },
    depTime: string,
  ) => {
    try {
      const res = await fetch('/api/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routes: ppl.map((p) => ({
            personId: p.id,
            originLat: p.lat,
            originLng: p.lng,
            destLat: dest.lat,
            destLng: dest.lng,
            mode: p.mode,
            color: p.color,
          })),
          departureTime: depTime,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRoutes(data.routes ?? []);
      }
    } catch {
      // Routes are visual enhancement — don't block on failure
    }
  };

  const handleSelectVenue = (venueId: string) => {
    setSelectedVenueId(venueId);
    const venue = displayItems.find((v) => v.placeId === venueId);
    if (venue) {
      const validPeople = people.filter((p) => p.lat !== 0 && p.lng !== 0);
      fetchRoutes(validPeople, { lat: venue.lat, lng: venue.lng }, departureTime);
    }
  };

  const shareLink = () => {
    const state: SessionState = {
      people: people.filter((p) => p.lat !== 0 && p.lng !== 0),
      objective: alpha >= 0.8 ? 'fairness' : alpha <= 0.2 ? 'efficiency' : 'blended',
      alpha,
      departureTime,
    };
    const encoded = encodeState(state);
    const url = `${window.location.origin}/m?s=${encoded}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayItems = buildDisplayItems(rankings, venues, candidateDetails, people, routes, selectedVenueId);
  const validCount = people.filter((p) => p.lat !== 0 && p.lng !== 0).length;
  const hasResults = displayItems.length > 0;

  return (
    <div className="flex h-screen flex-col lg:flex-row overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-full flex-col gap-5 overflow-y-auto p-5 lg:h-screen lg:w-[440px] lg:shrink-0 bg-background">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight gradient-text">midpoint</h1>
          {hasResults && (
            <button
              onClick={shareLink}
              className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  Share
                </>
              )}
            </button>
          )}
        </div>

        <p className="text-sm text-muted-foreground -mt-2">
          Find the fairest meeting spot for your group.
        </p>

        {/* People */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold">Who&apos;s coming?</label>
            {people.length < 6 && (
              <button
                onClick={addPerson}
                className="rounded-xl bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                + Add person
              </button>
            )}
          </div>
          {people.map((person, i) => (
            <PersonInput
              key={person.id}
              person={person}
              onUpdate={(p) => updatePerson(i, p)}
              onRemove={() => removePerson(i)}
              canRemove={people.length > 2}
            />
          ))}
          <p className="text-[11px] text-muted-foreground/60 pl-1">
            Click the map to set a location
          </p>
        </div>

        <div className="h-px bg-border/60" />

        <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />
        <ObjectiveSlider alpha={alpha} onChange={setAlpha} />

        {/* Find button */}
        <button
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-primary to-primary/85 text-base font-semibold text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/25 hover:brightness-105 disabled:opacity-50 disabled:pointer-events-none transition-all active:scale-[0.98]"
          onClick={findMidpoint}
          disabled={validCount < 2 || isLoading}
        >
          {isLoading
            ? 'Finding...'
            : validCount < 2
            ? `Add ${2 - validCount} more location${2 - validCount > 1 ? 's' : ''}`
            : 'Find the spot'}
        </button>

        {/* Loading stages */}
        {isLoading && (
          <div className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
            <LoadingStages currentStage={loadingStage} />
            <p className="mt-2 text-xs text-muted-foreground animate-pulse">{loadingDetail}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-sm text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* Outlier warning */}
        {outlierIndex !== null && (
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3.5 text-sm text-amber-700">
            <strong>{people[outlierIndex]?.label ?? 'Someone'}</strong> has a
            significantly longer commute.
          </div>
        )}

        {/* Heuristic notice */}
        {hasResults && usedHeuristic && (
          <div className="rounded-2xl bg-violet-50 border border-violet-100 p-3 text-xs text-violet-600">
            Times are estimates. Real-time data requires a Google Maps API key.
          </div>
        )}

        {/* Results */}
        {hasResults && !isLoading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">
                Top spots
              </h2>
              <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {displayItems.length} found
              </span>
            </div>
            {displayItems.slice(0, 5).map((item, i) => (
              <VenueCard
                key={item.placeId}
                venue={item}
                people={people.filter((p) => p.lat !== 0 && p.lng !== 0)}
                rank={i + 1}
                isSelected={item.placeId === selectedVenueId}
                onClick={() => handleSelectVenue(item.placeId)}
              />
            ))}

            {displayItems.length > 5 && (
              <TravelTimeGrid
                people={people.filter((p) => p.lat !== 0 && p.lng !== 0)}
                venues={displayItems}
                selectedVenueId={selectedVenueId}
                onSelectVenue={handleSelectVenue}
              />
            )}
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-4" />
      </div>

      {/* Map */}
      <div className="flex-1 lg:h-screen">
        <Map
          people={people}
          venues={displayItems}
          routes={routes}
          isochrones={isochrones}
          selectedVenueId={selectedVenueId}
          onMapClick={handleMapClick}
        />
      </div>
    </div>
  );
}

// Build display items from rankings + venues, falling back to neighborhood cards
function buildDisplayItems(
  rankings: TravelTimeResult[],
  venues: Venue[],
  candidateDetails: CandidateDetail[],
  people: Person[],
  routes: RouteFeature[],
  selectedVenueId: string | null,
): Venue[] {
  if (rankings.length === 0) return [];

  const validPeople = people.filter((p) => p.lat !== 0 && p.lng !== 0);
  let routeTimesForSelected: number[] | null = null;
  if (selectedVenueId && routes.length > 0) {
    routeTimesForSelected = validPeople.map((p) => {
      const route = routes.find((r) => r.personId === p.id);
      return route?.durationSeconds ?? 0;
    });
    if (routeTimesForSelected.some((t) => t === 0)) {
      routeTimesForSelected = null;
    }
  }

  if (venues.length > 0) {
    return venues.slice(0, 10).map((venue) => {
      if (venue.placeId === selectedVenueId && routeTimesForSelected) {
        return { ...venue, travelTimes: routeTimesForSelected };
      }

      let bestRanking = rankings[0];
      let bestDist = Infinity;
      for (const r of rankings) {
        const cd = candidateDetails.find((c) => c.hotspotId === r.hotspotId);
        if (!cd) continue;
        const dist = Math.abs(venue.lat - cd.lat) + Math.abs(venue.lng - cd.lng);
        if (dist < bestDist) {
          bestDist = dist;
          bestRanking = r;
        }
      }
      return { ...venue, travelTimes: bestRanking.times };
    });
  }

  return rankings.slice(0, 10).map((r) => {
    const cd = candidateDetails.find((c) => c.hotspotId === r.hotspotId);
    const isSelected = r.hotspotId === selectedVenueId;
    return {
      placeId: r.hotspotId,
      name: cd?.neighborhood ?? r.hotspotId,
      lat: cd?.lat ?? 0,
      lng: cd?.lng ?? 0,
      rating: 0,
      reviewCount: 0,
      types: [cd?.borough ?? ''],
      neighborhood: cd?.borough?.replace('_', ' ') ?? '',
      travelTimes: isSelected && routeTimesForSelected ? routeTimesForSelected : r.times,
    };
  });
}

// Loading stage indicator
function LoadingStages({ currentStage }: { currentStage: string }) {
  const stages = [
    { key: 'prefilter', label: 'Pre-filtering hotspots' },
    { key: 'travel_times', label: 'Calculating travel times' },
    { key: 'scoring', label: 'Scoring candidates' },
    { key: 'venues', label: 'Finding venues' },
  ];

  const currentIndex = stages.findIndex((s) => s.key === currentStage);

  return (
    <div className="space-y-2">
      {stages.map((stage, i) => {
        const isActive = stage.key === currentStage;
        const isDone = i < currentIndex || currentStage === 'done';

        return (
          <div key={stage.key} className="flex items-center gap-2.5 text-sm">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all ${
              isDone ? 'bg-emerald-100 text-emerald-600' :
              isActive ? 'bg-primary text-white animate-pulse-dot shadow-sm shadow-primary/30' :
              'bg-muted text-muted-foreground/50'
            }`}>
              {isDone ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                i + 1
              )}
            </span>
            <span className={`text-sm ${isDone ? 'text-muted-foreground' : isActive ? 'font-medium text-foreground' : 'text-muted-foreground/50'}`}>
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
