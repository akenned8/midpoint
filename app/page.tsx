// Main app shell — "Find the Spot" and "Evaluate a Spot" modes
'use client';

import { useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import PersonInput from '@/components/PersonInput';
import VenueCard from '@/components/VenueCard';
import TravelTimeGrid from '@/components/TravelTimeGrid';
import ObjectiveSlider from '@/components/ObjectiveSlider';
import DepartureTimePicker from '@/components/DepartureTimePicker';
import { encodeState } from '@/lib/url-state';
import { detectOutlier } from '@/lib/scoring';
import type { Person, Venue, SessionState, TravelTimeResult } from '@/types';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

const PERSON_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

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
  prefilter: 'Analyzing locations and filtering candidates...',
  travel_times: 'Calculating travel times...',
  scoring: 'Scoring and ranking candidates...',
  venues: 'Finding nearby restaurants, bars, and cafes...',
  done: 'Done!',
};

function formatTime(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export default function Home() {
  const [people, setPeople] = useState<Person[]>([createPerson(0), createPerson(1)]);
  const [alpha, setAlpha] = useState(0.7);
  const [departureTime, setDepartureTime] = useState('now');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [rankings, setRankings] = useState<TravelTimeResult[]>([]);
  const [candidateDetails, setCandidateDetails] = useState<CandidateDetail[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [isochrones, setIsochrones] = useState<GeoJSON.FeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [loadingDetail, setLoadingDetail] = useState('');
  const [outlierIndex, setOutlierIndex] = useState<number | null>(null);
  const [usedHeuristic, setUsedHeuristic] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    // Abort previous request
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

              // Check for outlier
              if (r?.[0]?.times) {
                setOutlierIndex(detectOutlier(r[0].times));
              }

              // Fetch isochrones for top result
              const nonTransit = validPeople.find((p) => p.mode !== 'transit');
              const topCandidate = cd.find((c) => c.hotspotId === r?.[0]?.hotspotId);
              if (nonTransit && topCandidate) {
                fetch('/api/isochrones', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    lat: topCandidate.lat,
                    lng: topCandidate.lng,
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
  };

  // Build display items: venues with travel times, or ranked neighborhoods as fallback
  const displayItems = buildDisplayItems(rankings, venues, candidateDetails, people);
  const validCount = people.filter((p) => p.lat !== 0 && p.lng !== 0).length;
  const hasResults = displayItems.length > 0;

  return (
    <div className="flex h-screen flex-col lg:flex-row overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-full flex-col gap-4 overflow-y-auto border-r p-4 lg:h-screen lg:w-[420px] lg:shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Midpoint</h1>
          {hasResults && (
            <Button variant="outline" size="sm" onClick={shareLink}>
              Share
            </Button>
          )}
        </div>

        <Tabs defaultValue="find">
          <TabsList className="w-full">
            <TabsTrigger value="find" className="flex-1">Find the Spot</TabsTrigger>
            <TabsTrigger value="evaluate" className="flex-1">Evaluate a Spot</TabsTrigger>
          </TabsList>

          <TabsContent value="find" className="mt-4 space-y-4">
            {/* People inputs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Who&apos;s coming?</label>
                {people.length < 6 && (
                  <Button variant="ghost" size="sm" onClick={addPerson} className="h-7 text-xs">
                    + Add person
                  </Button>
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
              <p className="text-xs text-muted-foreground">
                Tip: click the map to set a person&apos;s location
              </p>
            </div>

            <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />
            <ObjectiveSlider alpha={alpha} onChange={setAlpha} />

            {/* Find button */}
            <Button
              className="w-full"
              size="lg"
              onClick={findMidpoint}
              disabled={validCount < 2 || isLoading}
            >
              {isLoading
                ? 'Finding...'
                : `Find the spot${validCount < 2 ? ` (need ${2 - validCount} more)` : ''}`}
            </Button>

            {/* Loading stages */}
            {isLoading && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <LoadingStages currentStage={loadingStage} />
                <p className="text-xs text-muted-foreground animate-pulse">{loadingDetail}</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>
            )}

            {/* Outlier warning */}
            {outlierIndex !== null && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                <strong>{people[outlierIndex]?.label ?? 'Someone'}</strong> has a
                significantly longer travel time than the rest of the group.
              </div>
            )}

            {/* Heuristic notice */}
            {hasResults && usedHeuristic && (
              <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-700">
                Travel times are estimates. Connect a Google Maps API key for real-time data.
              </div>
            )}

            {/* Results */}
            {hasResults && !isLoading && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium">
                  Top spots ({displayItems.length} found)
                </h2>
                {displayItems.slice(0, 5).map((item, i) => (
                  <VenueCard
                    key={item.placeId}
                    venue={item}
                    people={people.filter((p) => p.lat !== 0 && p.lng !== 0)}
                    rank={i + 1}
                    isSelected={item.placeId === selectedVenueId}
                    onClick={() => setSelectedVenueId(item.placeId)}
                  />
                ))}

                {displayItems.length > 5 && (
                  <TravelTimeGrid
                    people={people.filter((p) => p.lat !== 0 && p.lng !== 0)}
                    venues={displayItems}
                    selectedVenueId={selectedVenueId}
                    onSelectVenue={setSelectedVenueId}
                  />
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="evaluate" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Have a spot in mind? Drop a pin on the map and we&apos;ll show
              everyone&apos;s travel time to that location.
            </p>
            <div className="space-y-2">
              {people.map((person, i) => (
                <PersonInput
                  key={person.id}
                  person={person}
                  onUpdate={(p) => updatePerson(i, p)}
                  onRemove={() => removePerson(i)}
                  canRemove={people.length > 2}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Map */}
      <div className="flex-1 lg:h-screen">
        <Map
          people={people}
          venues={displayItems}
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
): Venue[] {
  if (rankings.length === 0) return [];

  // If we have venues, attach travel times from the nearest ranking
  if (venues.length > 0) {
    return venues.slice(0, 10).map((venue) => {
      // Find closest ranking candidate
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

  // Fallback: show ranked neighborhoods as pseudo-venues
  return rankings.slice(0, 10).map((r) => {
    const cd = candidateDetails.find((c) => c.hotspotId === r.hotspotId);
    return {
      placeId: r.hotspotId,
      name: cd?.neighborhood ?? r.hotspotId,
      lat: cd?.lat ?? 0,
      lng: cd?.lng ?? 0,
      rating: 0,
      reviewCount: 0,
      types: [cd?.borough ?? ''],
      neighborhood: cd?.borough?.replace('_', ' ') ?? '',
      travelTimes: r.times,
    };
  });
}

// Loading stage indicator component
function LoadingStages({ currentStage }: { currentStage: string }) {
  const stages = [
    { key: 'prefilter', label: 'Pre-filtering hotspots' },
    { key: 'travel_times', label: 'Calculating travel times' },
    { key: 'scoring', label: 'Scoring candidates' },
    { key: 'venues', label: 'Finding venues' },
  ];

  const currentIndex = stages.findIndex((s) => s.key === currentStage);

  return (
    <div className="space-y-1.5">
      {stages.map((stage, i) => {
        const isActive = stage.key === currentStage;
        const isDone = i < currentIndex || currentStage === 'done';

        return (
          <div key={stage.key} className="flex items-center gap-2 text-sm">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
              isDone ? 'bg-green-100 text-green-700' :
              isActive ? 'bg-primary text-primary-foreground animate-pulse' :
              'bg-muted text-muted-foreground'
            }`}>
              {isDone ? '✓' : i + 1}
            </span>
            <span className={isDone ? 'text-muted-foreground line-through' : isActive ? 'font-medium' : 'text-muted-foreground'}>
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
