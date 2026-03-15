// Main app shell
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
    lat: 0, lng: 0,
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

// Bottom sheet snap points (% of viewport height from bottom)
type SheetSnap = 'peek' | 'half' | 'full';
const SNAP_HEIGHTS: Record<SheetSnap, number> = { peek: 160, half: 50, full: 92 };

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
  const [mode, setMode] = useState<'find' | 'evaluate'>('find');
  const [evalPin, setEvalPin] = useState<{ lat: number; lng: number } | null>(null);
  const [evalRoutes, setEvalRoutes] = useState<RouteFeature[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Mobile bottom sheet state
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [sheetDragY, setSheetDragY] = useState<number | null>(null);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ y: number; startHeight: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const getSnapHeight = useCallback((snap: SheetSnap) => {
    if (typeof window === 'undefined') return 400;
    if (snap === 'peek') return SNAP_HEIGHTS.peek;
    return (window.innerHeight * SNAP_HEIGHTS[snap]) / 100;
  }, []);

  const onDragStart = useCallback((clientY: number) => {
    const current = sheetHeight ?? getSnapHeight(sheetSnap);
    dragStartRef.current = { y: clientY, startHeight: current };
  }, [sheetHeight, sheetSnap, getSnapHeight]);

  const onDragMove = useCallback((clientY: number) => {
    if (!dragStartRef.current) return;
    const delta = dragStartRef.current.y - clientY;
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.95, dragStartRef.current.startHeight + delta));
    setSheetDragY(newHeight);
    setSheetHeight(newHeight);
  }, []);

  const onDragEnd = useCallback(() => {
    dragStartRef.current = null;
    setSheetDragY(null);
    if (sheetHeight === null) return;

    const vh = window.innerHeight;
    const peekH = SNAP_HEIGHTS.peek;
    const halfH = vh * SNAP_HEIGHTS.half / 100;
    const fullH = vh * SNAP_HEIGHTS.full / 100;

    // Snap to nearest
    const dists = [
      { snap: 'peek' as SheetSnap, d: Math.abs(sheetHeight - peekH) },
      { snap: 'half' as SheetSnap, d: Math.abs(sheetHeight - halfH) },
      { snap: 'full' as SheetSnap, d: Math.abs(sheetHeight - fullH) },
    ];
    dists.sort((a, b) => a.d - b.d);
    setSheetSnap(dists[0].snap);
    setSheetHeight(null);
  }, [sheetHeight]);

  // Touch handlers for the drag handle
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    onDragStart(e.touches[0].clientY);
  }, [onDragStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    onDragMove(e.touches[0].clientY);
  }, [onDragMove]);

  const handleTouchEnd = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  // Expand sheet when results come in
  useEffect(() => {
    if (isLoading) setSheetSnap('half');
  }, [isLoading]);

  const displayItems = buildDisplayItems(rankings, venues, candidateDetails, people, routes, selectedVenueId);
  const hasResults = displayItems.length > 0;

  useEffect(() => {
    if (hasResults && !isLoading) setSheetSnap('half');
  }, [hasResults, isLoading]);

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
      if (mode === 'evaluate') {
        setEvalPin({ lat, lng });
        // Fetch routes from all valid people to this pin
        const valid = people.filter((p) => p.lat !== 0 && p.lng !== 0);
        if (valid.length > 0) {
          fetchRoutesToPin(valid, { lat, lng }, departureTime);
        }
        return;
      }
      const emptyIdx = people.findIndex((p) => p.lat === 0 && p.lng === 0);
      if (emptyIdx >= 0) {
        const updated = [...people];
        updated[emptyIdx] = { ...updated[emptyIdx], lat, lng };
        setPeople(updated);
      }
    },
    [people, mode, departureTime]
  );

  const fetchRoutesToPin = async (ppl: Person[], dest: { lat: number; lng: number }, depTime: string) => {
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
      if (res.ok) { const data = await res.json(); setEvalRoutes(data.routes ?? []); }
    } catch {}
  };

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
          alpha, departureTime,
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
              setRankings(r); setVenues(v); setCandidateDetails(cd);
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
                      lat: routeDest.lat, lng: routeDest.lng,
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
      if ((err as Error).name !== 'AbortError') { console.error('Optimize error:', err); setError('Request failed'); }
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
      alpha, departureTime,
    };
    navigator.clipboard.writeText(`${window.location.origin}/m?s=${encodeState(state)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const validCount = people.filter((p) => p.lat !== 0 && p.lng !== 0).length;

  // Compute the mobile sheet height
  const currentSheetHeight = sheetDragY !== null
    ? sheetDragY
    : getSnapHeight(sheetSnap);

  // Format seconds to human time
  const formatTime = (seconds: number) => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  };

  // People section (shared between modes)
  const peopleSection = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[#1D1D1F]">People</span>
        {people.length < 6 && (
          <button onClick={addPerson} className="text-[13px] font-medium text-[#007AFF] hover:text-[#0071EB] transition-colors">
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
      <p className="text-[11px] text-[#86868B] pl-0.5">Tap the map to set a location.</p>
    </div>
  );

  // Mode segmented control
  const modeSelector = (
    <div className="flex rounded-lg bg-[#F5F5F7] p-[2px]">
      <button
        className={`flex-1 h-[30px] rounded-md text-[12px] font-medium transition-all ${
          mode === 'find' ? 'bg-white text-[#1D1D1F] shadow-sm shadow-black/8' : 'text-[#86868B] hover:text-[#1D1D1F]'
        }`}
        onClick={() => setMode('find')}
      >
        Find the Spot
      </button>
      <button
        className={`flex-1 h-[30px] rounded-md text-[12px] font-medium transition-all ${
          mode === 'evaluate' ? 'bg-white text-[#1D1D1F] shadow-sm shadow-black/8' : 'text-[#86868B] hover:text-[#1D1D1F]'
        }`}
        onClick={() => setMode('evaluate')}
      >
        Evaluate a Spot
      </button>
    </div>
  );

  // The shared panel content
  const panelContent = (
    <>
      {modeSelector}

      {mode === 'find' ? (
        <>
          {peopleSection}
          <div className="h-px bg-black/[0.04]" />
          <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />
          <ObjectiveSlider alpha={alpha} onChange={setAlpha} />

          <button
            className="w-full h-[44px] rounded-xl bg-[#007AFF] text-[15px] font-medium text-white hover:bg-[#0071EB] disabled:opacity-40 disabled:pointer-events-none transition-colors active:opacity-80"
            onClick={findMidpoint}
            disabled={validCount < 2 || isLoading}
          >
            {isLoading ? 'Finding...' : validCount < 2 ? `Set ${2 - validCount} more location${2 - validCount > 1 ? 's' : ''}` : 'Find the Spot'}
          </button>

          {isLoading && (
            <div className="rounded-xl bg-white border border-black/[0.06] p-4">
              <LoadingStages currentStage={loadingStage} />
              <p className="mt-2.5 text-[11px] text-[#86868B]">{loadingDetail}</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-[#FF3B30]/8 border border-[#FF3B30]/15 px-3.5 py-2.5 text-[13px] text-[#FF3B30] font-medium">{error}</div>
          )}

          {outlierIndex !== null && (
            <div className="rounded-xl bg-[#FF9500]/8 border border-[#FF9500]/15 px-3.5 py-2.5 text-[13px] text-[#FF9500]">
              <span className="font-semibold">{people[outlierIndex]?.label ?? 'Someone'}</span> has a significantly longer commute.
            </div>
          )}

          {hasResults && usedHeuristic && (
            <div className="rounded-xl bg-[#5856D6]/8 border border-[#5856D6]/15 px-3.5 py-2.5 text-[12px] text-[#5856D6]">
              Times are estimates. Live data requires a Google Maps API key.
            </div>
          )}

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
        </>
      ) : (
        <>
          {peopleSection}
          <div className="h-px bg-black/[0.04]" />
          <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />

          <div className="rounded-xl bg-[#F5F5F7] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF9500]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[#1D1D1F]">
                  {evalPin ? `${evalPin.lat.toFixed(4)}, ${evalPin.lng.toFixed(4)}` : 'Drop a pin on the map'}
                </p>
                <p className="text-[11px] text-[#86868B]">
                  {evalPin ? 'Tap map to move pin' : 'Tap anywhere to evaluate travel times'}
                </p>
              </div>
              {evalPin && (
                <button
                  onClick={() => { setEvalPin(null); setEvalRoutes([]); }}
                  className="ml-auto text-[12px] font-medium text-[#FF3B30]"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Travel time results for the pin */}
            {evalPin && evalRoutes.length > 0 && (
              <div className="space-y-2 pt-1">
                {people.filter((p) => p.lat !== 0 && p.lng !== 0).map((person) => {
                  const route = evalRoutes.find((r) => r.personId === person.id);
                  const seconds = route?.durationSeconds ?? 0;
                  return (
                    <div key={person.id} className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: person.color }} />
                      <span className="text-[13px] text-[#1D1D1F] flex-1">{person.label}</span>
                      <span className={`text-[13px] font-semibold tabular-nums ${
                        seconds / 60 <= 20 ? 'text-[#34C759]' : seconds / 60 <= 35 ? 'text-[#FF9500]' : 'text-[#FF3B30]'
                      }`}>
                        {seconds > 0 ? formatTime(seconds) : '...'}
                      </span>
                    </div>
                  );
                })}
                {evalRoutes.length > 0 && (
                  <div className="flex justify-between pt-2 border-t border-black/[0.06] text-[11px] text-[#86868B]">
                    <span>Avg <span className="font-semibold text-[#1D1D1F]">
                      {formatTime(evalRoutes.reduce((s, r) => s + r.durationSeconds, 0) / evalRoutes.length)}
                    </span></span>
                    <span>Max <span className="font-semibold text-[#1D1D1F]">
                      {formatTime(Math.max(...evalRoutes.map((r) => r.durationSeconds)))}
                    </span></span>
                  </div>
                )}
              </div>
            )}

            {evalPin && evalRoutes.length === 0 && validCount > 0 && (
              <p className="text-[12px] text-[#86868B]">Calculating routes...</p>
            )}

            {!evalPin && validCount === 0 && (
              <p className="text-[12px] text-[#86868B]">Set people locations first, then tap the map.</p>
            )}
          </div>
        </>
      )}
      <div className="h-8" />
    </>
  );

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Map — always full screen */}
      <div className="absolute inset-0">
        <Map
          people={people}
          venues={mode === 'find' ? displayItems : []}
          routes={mode === 'evaluate' ? evalRoutes : routes}
          isochrones={mode === 'find' ? isochrones : null}
          selectedVenueId={mode === 'find' ? selectedVenueId : null}
          evalPin={mode === 'evaluate' ? evalPin : null}
          onMapClick={handleMapClick}
        />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex absolute inset-y-0 left-0 w-[400px] flex-col bg-[#FBFBFD]/95 backdrop-blur-xl border-r border-black/[0.06] z-20">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <div className="flex items-center gap-2">
            <MidpointLogo size={24} />
            <h1 className="text-[20px] font-semibold tracking-tight text-[#1D1D1F]">Midpoint</h1>
          </div>
          {hasResults && (
            <button onClick={shareLink} className="flex items-center gap-1 text-[13px] font-medium text-[#007AFF] hover:text-[#0071EB] transition-colors">
              {copied ? 'Copied!' : 'Share'}
              {!copied && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-5">
            {panelContent}
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <div
        ref={sheetRef}
        className="lg:hidden absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-[#FBFBFD]/[0.97] backdrop-blur-2xl rounded-t-2xl shadow-[0_-4px_30px_rgba(0,0,0,0.08)]"
        style={{
          height: currentSheetHeight,
          transition: sheetDragY !== null ? 'none' : 'height 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
          maxHeight: '95vh',
        }}
      >
        {/* Drag handle + header */}
        <div
          className="shrink-0 touch-none select-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Grab bar */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-[5px] w-9 rounded-full bg-black/15" />
          </div>
          {/* Header row */}
          <div className="flex items-center justify-between px-5 pb-3">
            <div className="flex items-center gap-1.5">
              <MidpointLogo size={20} />
              <h1 className="text-[17px] font-semibold tracking-tight text-[#1D1D1F]">Midpoint</h1>
            </div>
            <div className="flex items-center gap-3">
              {hasResults && (
                <button onClick={shareLink} className="text-[13px] font-medium text-[#007AFF]">
                  {copied ? 'Copied!' : 'Share'}
                </button>
              )}
              {/* Quick expand/collapse */}
              <button
                onClick={() => setSheetSnap(sheetSnap === 'full' ? 'peek' : 'full')}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/5"
              >
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86868B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`transition-transform ${sheetSnap === 'full' ? 'rotate-180' : ''}`}
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-4 px-5 pb-8">
            {panelContent}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildDisplayItems(
  rankings: TravelTimeResult[], venues: Venue[], candidateDetails: CandidateDetail[],
  people: Person[], routes: RouteFeature[], selectedVenueId: string | null,
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
      let bestRanking = rankings[0]; let bestDist = Infinity;
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
      placeId: r.hotspotId, name: cd?.neighborhood ?? r.hotspotId,
      lat: cd?.lat ?? 0, lng: cd?.lng ?? 0, rating: 0, reviewCount: 0,
      types: [cd?.borough ?? ''], neighborhood: cd?.borough?.replace('_', ' ') ?? '',
      travelTimes: isSelected && routeTimesForSelected ? routeTimesForSelected : r.times,
    };
  });
}

function MidpointLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Two converging paths meeting at a central point */}
      <circle cx="16" cy="16" r="14" fill="#007AFF" fillOpacity="0.08" />
      <path d="M8 24L16 12L24 24" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="12" r="3.5" fill="#007AFF" />
      <circle cx="16" cy="12" r="1.5" fill="white" />
    </svg>
  );
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
            {i > 0 && <div className={`h-[1px] w-4 ${isDone ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'} transition-colors`} />}
            <div className="flex items-center gap-1.5">
              <div className={`h-[18px] w-[18px] flex items-center justify-center rounded-full text-[9px] font-bold transition-all ${
                isDone ? 'bg-[#34C759] text-white' : isActive ? 'bg-[#007AFF] text-white' : 'bg-[#F5F5F7] text-[#86868B]'
              }`}>
                {isDone ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : i + 1}
              </div>
              <span className={`text-[11px] ${isDone ? 'text-[#34C759]' : isActive ? 'font-medium text-[#1D1D1F]' : 'text-[#86868B]'}`}>{stage.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
