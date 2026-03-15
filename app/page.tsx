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

const PERSON_COLORS = ['#007AFF', '#FF9500', '#34C759', '#FF2D55', '#5856D6', '#FF3B30'];

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
  travel_times: 'Fetching live travel times...',
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

      if (!res.ok) { setError('Optimization failed'); setIsLoading(false); return; }

      const reader = res.body?.getReader();
      if (!reader) { setError('No response stream'); setIsLoading(false); return; }

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

              if (r?.[0]?.times) setOutlierIndex(detectOutlier(r[0].times));

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
                    if (isoRes.ok && isoRes.status !== 204) setIsochrones(await isoRes.json());
                  }).catch(() => {});
                }
              }
            }

            if (msg.type === 'error') setError(msg.error);
          } catch {}
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

  const fetchRoutes = async (ppl: Person[], dest: { lat: number; lng: number }, depTime: string) => {
    try {
      const res = await fetch('/api/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routes: ppl.map((p) => ({
            personId: p.id, originLat: p.lat, originLng: p.lng,
            destLat: dest.lat, destLng: dest.lng, mode: p.mode, color: p.color,
          })),
          departureTime: depTime,
        }),
      });
      if (res.ok) { const data = await res.json(); setRoutes(data.routes ?? []); }
    } catch {}
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
    navigator.clipboard.writeText(`${window.location.origin}/m?s=${encoded}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayItems = buildDisplayItems(rankings, venues, candidateDetails, people, routes, selectedVenueId);
  const validCount = people.filter((p) => p.lat !== 0 && p.lng !== 0).length;
  const hasResults = displayItems.length > 0;

  return (
    <div className="flex h-screen flex-col lg:flex-row overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-full flex-col overflow-y-auto lg:h-screen lg:w-[400px] lg:shrink-0 bg-[#FBFBFD] border-r border-black/[0.06]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-[#FBFBFD]/80 backdrop-blur-xl border-b border-black/[0.04]">
          <h1 className="text-[20px] font-semibold tracking-tight text-[#1D1D1F]">Midpoint</h1>
          {hasResults && (
            <button
              onClick={shareLink}
              className="flex items-center gap-1 text-[13px] font-medium text-[#007AFF] hover:text-[#0071EB] transition-colors"
            >
              {copied ? 'Copied!' : 'Share'}
              {!copied && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              )}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-5 p-5">
          {/* People */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-[#1D1D1F]">People</span>
              {people.length < 6 && (
                <button
                  onClick={addPerson}
                  className="text-[13px] font-medium text-[#007AFF] hover:text-[#0071EB] transition-colors"
                >
                  Add Person
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
            <p className="text-[11px] text-[#86868B] pl-0.5">
              Tap the map to set a location.
            </p>
          </div>

          <div className="h-px bg-black/[0.04]" />

          <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />
          <ObjectiveSlider alpha={alpha} onChange={setAlpha} />

          {/* CTA */}
          <button
            className="w-full h-[44px] rounded-xl bg-[#007AFF] text-[15px] font-medium text-white hover:bg-[#0071EB] disabled:opacity-40 disabled:pointer-events-none transition-colors active:opacity-80"
            onClick={findMidpoint}
            disabled={validCount < 2 || isLoading}
          >
            {isLoading
              ? 'Finding...'
              : validCount < 2
              ? `Set ${2 - validCount} more location${2 - validCount > 1 ? 's' : ''}`
              : 'Find the Spot'}
          </button>

          {/* Loading */}
          {isLoading && (
            <div className="rounded-xl bg-white border border-black/[0.06] p-4">
              <LoadingStages currentStage={loadingStage} />
              <p className="mt-2.5 text-[11px] text-[#86868B]">{loadingDetail}</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-[#FF3B30]/8 border border-[#FF3B30]/15 px-3.5 py-2.5 text-[13px] text-[#FF3B30] font-medium">
              {error}
            </div>
          )}

          {/* Outlier */}
          {outlierIndex !== null && (
            <div className="rounded-xl bg-[#FF9500]/8 border border-[#FF9500]/15 px-3.5 py-2.5 text-[13px] text-[#FF9500]">
              <span className="font-semibold">{people[outlierIndex]?.label ?? 'Someone'}</span> has a significantly longer commute.
            </div>
          )}

          {/* Heuristic notice */}
          {hasResults && usedHeuristic && (
            <div className="rounded-xl bg-[#5856D6]/8 border border-[#5856D6]/15 px-3.5 py-2.5 text-[12px] text-[#5856D6]">
              Times are estimates. Live data requires a Google Maps API key.
            </div>
          )}

          {/* Results */}
          {hasResults && !isLoading && (
            <div className="space-y-2.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[15px] font-semibold text-[#1D1D1F]">Results</h2>
                <span className="text-[12px] text-[#86868B]">{displayItems.length} spots found</span>
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

          <div className="h-6" />
        </div>
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
    if (routeTimesForSelected.some((t) => t === 0)) routeTimesForSelected = null;
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
        if (dist < bestDist) { bestDist = dist; bestRanking = r; }
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
      lat: cd?.lat ?? 0, lng: cd?.lng ?? 0,
      rating: 0, reviewCount: 0,
      types: [cd?.borough ?? ''],
      neighborhood: cd?.borough?.replace('_', ' ') ?? '',
      travelTimes: isSelected && routeTimesForSelected ? routeTimesForSelected : r.times,
    };
  });
}

function LoadingStages({ currentStage }: { currentStage: string }) {
  const stages = [
    { key: 'prefilter', label: 'Pre-filtering' },
    { key: 'travel_times', label: 'Travel times' },
    { key: 'scoring', label: 'Scoring' },
    { key: 'venues', label: 'Finding venues' },
  ];

  const currentIndex = stages.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, i) => {
        const isActive = stage.key === currentStage;
        const isDone = i < currentIndex || currentStage === 'done';

        return (
          <div key={stage.key} className="flex items-center gap-1">
            {i > 0 && (
              <div className={`h-[1px] w-4 ${isDone ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'} transition-colors`} />
            )}
            <div className="flex items-center gap-1.5">
              <div className={`h-[18px] w-[18px] flex items-center justify-center rounded-full text-[9px] font-bold transition-all ${
                isDone ? 'bg-[#34C759] text-white' :
                isActive ? 'bg-[#007AFF] text-white' :
                'bg-[#F5F5F7] text-[#86868B]'
              }`}>
                {isDone ? (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-[11px] ${
                isDone ? 'text-[#34C759]' : isActive ? 'font-medium text-[#1D1D1F]' : 'text-[#86868B]'
              }`}>
                {stage.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
