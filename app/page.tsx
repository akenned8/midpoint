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
const SNAP_HEIGHTS: Record<SheetSnap, number> = { peek: 196, half: 56, full: 94 };

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
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
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

  // Generate a 4-character random access code (avoids 0/O/1/I confusion)
  const generateCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  };

  const openShare = () => {
    if (!shareOpen) {
      setShareCode(generateCode());
      setShareLink(null);
    }
    setShareOpen(!shareOpen);
  };

  const handleCreateShare = async () => {
    setShareBusy(true);
    const link = await createShareableSession(shareCode.trim().toUpperCase());
    setShareBusy(false);
    if (link) setShareLink(link);
  };

  const copyShareLink = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Build a session and return the link + the code that protects it
  const createShareableSession = async (accessCode: string): Promise<string | null> => {
    const validPeople = people.filter((p) => p.lat !== 0 && p.lng !== 0);
    const allPeople = people;
    const objective = alpha >= 0.8 ? 'fairness' : alpha <= 0.2 ? 'efficiency' : 'blended';
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          people: allPeople,
          objective,
          alpha,
          departureTime,
          accessCode: accessCode || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return `${window.location.origin}/s/${data.id}`;
      }
    } catch {}
    // Fallback: URL-encoded state (no access code support)
    const state: SessionState = { people: validPeople, objective, alpha, departureTime };
    return `${window.location.origin}/m?s=${encodeState(state)}`;
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

  // Top result summary for peek state
  const topResult = hasResults ? displayItems[0] : null;
  const topAvg = topResult && topResult.travelTimes.length > 0
    ? topResult.travelTimes.reduce((a, b) => a + b, 0) / topResult.travelTimes.length
    : 0;
  const topMax = topResult && topResult.travelTimes.length > 0
    ? Math.max(...topResult.travelTimes)
    : 0;

  // People section (shared between modes)
  const peopleSection = (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">01 / Who</span>
        {people.length < 6 && (
          <button
            type="button"
            onClick={addPerson}
            className="ml-3 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--signal)] hover:text-[var(--signal-deep)] transition-colors"
          >
            + Add
          </button>
        )}
      </div>
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
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)] pl-0.5">
        Tap the map to set a location
      </p>
    </div>
  );

  // Share popover — appears below the Share button
  const sharePopover = shareOpen && (
    <div className="absolute right-0 top-full mt-2 w-[300px] z-40 rounded-sm border border-[var(--ink)] bg-[var(--card)] shadow-[0_12px_32px_rgba(20,23,31,0.18)] anim-fade-up">
      <div className="px-4 py-3 border-b border-[var(--rule)] bg-[var(--paper-deep)]/40 flex items-center justify-between">
        <span className="eyebrow !flex-none after:hidden">Share session</span>
        <button
          type="button"
          onClick={() => setShareOpen(false)}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          Close ×
        </button>
      </div>
      <div className="p-4 space-y-3">
        {!shareLink ? (
          <>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Access code
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={shareCode}
                  onChange={(e) => setShareCode(e.target.value.toUpperCase().slice(0, 8))}
                  placeholder="CODE"
                  maxLength={8}
                  className="h-[42px] flex-1 rounded-sm border border-[var(--rule)] bg-[var(--paper)] px-3 font-mono text-[16px] tracking-[0.2em] uppercase text-center text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShareCode(generateCode())}
                  className="h-[42px] w-[42px] rounded-sm border border-[var(--rule)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--paper-deep)]/50 transition-colors"
                  title="Regenerate"
                  aria-label="Regenerate"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><polyline points="21 3 21 8 16 8" />
                  </svg>
                </button>
              </div>
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                Friends will need this to view the session
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreateShare}
              disabled={shareBusy || !shareCode.trim()}
              className="w-full h-[44px] rounded-sm bg-[var(--ink)] text-[12px] font-mono uppercase tracking-[0.16em] text-[var(--paper)] hover:bg-[var(--signal-deep)] disabled:opacity-30 disabled:pointer-events-none transition-colors active:scale-[0.99]"
            >
              {shareBusy ? 'Creating…' : 'Create share link →'}
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Link
              </label>
              <div className="mt-1.5 rounded-sm border border-[var(--rule)] bg-[var(--paper)] px-3 py-2.5 font-mono text-[11px] text-[var(--ink)] break-all">
                {shareLink}
              </div>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Access code
              </label>
              <div className="mt-1.5 rounded-sm border-2 border-[var(--ink)] bg-[var(--paper-deep)]/50 py-3 font-mono text-[26px] font-bold tracking-[0.3em] text-center text-[var(--ink)]">
                {shareCode || '—'}
              </div>
            </div>
            <button
              type="button"
              onClick={copyShareLink}
              className="w-full h-[44px] rounded-sm bg-[var(--ink)] text-[12px] font-mono uppercase tracking-[0.16em] text-[var(--paper)] hover:bg-[var(--signal-deep)] transition-colors active:scale-[0.99]"
            >
              {copied ? '✓ Link copied' : 'Copy link'}
            </button>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)] text-center leading-relaxed">
              Send the link & text the code separately
            </p>
          </>
        )}
      </div>
    </div>
  );

  // Mode segmented control
  const modeSelector = (
    <div className="grid grid-cols-2 border border-[var(--rule)] rounded-sm overflow-hidden">
      <button
        type="button"
        className={`h-[36px] text-[11px] font-mono uppercase tracking-[0.1em] transition-colors ${
          mode === 'find'
            ? 'bg-[var(--ink)] text-[var(--paper)]'
            : 'bg-[var(--card)] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]/50'
        }`}
        onClick={() => setMode('find')}
      >
        Find the Spot
      </button>
      <button
        type="button"
        className={`h-[36px] text-[11px] font-mono uppercase tracking-[0.1em] border-l border-[var(--rule)] transition-colors ${
          mode === 'evaluate'
            ? 'bg-[var(--ink)] text-[var(--paper)]'
            : 'bg-[var(--card)] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]/50'
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
            type="button"
            className="group relative w-full h-[52px] rounded-sm bg-[var(--ink)] text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--paper)] hover:bg-[var(--signal-deep)] disabled:opacity-30 disabled:pointer-events-none transition-colors active:scale-[0.99] overflow-hidden"
            onClick={findMidpoint}
            disabled={validCount < 2 || isLoading}
          >
            <span className="relative z-10">
              {isLoading ? 'Finding…' : validCount < 2 ? `Set ${2 - validCount} more` : 'Find the Spot →'}
            </span>
            {isLoading && <span className="absolute inset-x-0 bottom-0 h-[2px] anim-loading-bar" />}
          </button>

          {isLoading && (
            <div className="rounded-sm border border-[var(--rule)] bg-[var(--card)] p-4">
              <LoadingStages currentStage={loadingStage} />
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">{loadingDetail}</p>
            </div>
          )}

          {error && (
            <div className="rounded-sm border-l-2 border-[var(--hot)] bg-[var(--hot)]/[0.06] px-3.5 py-2.5 text-[12px] text-[var(--hot)] font-medium">
              {error}
            </div>
          )}

          {outlierIndex !== null && (
            <div className="rounded-sm border-l-2 border-[var(--warn)] bg-[var(--warn)]/[0.06] px-3.5 py-2.5 text-[12px] text-[var(--ink-soft)]">
              <span className="font-semibold text-[var(--ink)]">{people[outlierIndex]?.label ?? 'Someone'}</span> has a significantly longer commute.
            </div>
          )}

          {hasResults && usedHeuristic && (
            <div className="rounded-sm border-l-2 border-[var(--signal)] bg-[var(--signal)]/[0.05] px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-soft)]">
              Estimated times — live data requires API key
            </div>
          )}

          {hasResults && !isLoading && (
            <div className="space-y-3 anim-fade-up">
              <div className="flex items-baseline gap-2">
                <span className="eyebrow">04 / Results</span>
                <span className="font-mono text-[10px] tnum text-[var(--ink-muted)] shrink-0">
                  {String(displayItems.length).padStart(2, '0')} found
                </span>
              </div>
              <div className="space-y-2.5">
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
              </div>
              {displayItems.length > 5 && (
                <div className="space-y-2">
                  <div className="eyebrow">More options</div>
                  <TravelTimeGrid
                    people={people.filter((p) => p.lat !== 0 && p.lng !== 0)}
                    venues={displayItems}
                    selectedVenueId={selectedVenueId}
                    onSelectVenue={handleSelectVenue}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {peopleSection}
          <div className="h-px bg-black/[0.04]" />
          <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />

          <div className="rounded-sm border border-[var(--rule)] bg-[var(--card)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-dashed border-[var(--rule)] bg-[var(--paper-deep)]/40">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--hot)]">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] tnum text-[var(--ink)] truncate">
                  {evalPin ? `${evalPin.lat.toFixed(4)}, ${evalPin.lng.toFixed(4)}` : 'No pin set'}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)] mt-0.5">
                  {evalPin ? 'Tap map to move' : 'Tap anywhere to evaluate'}
                </p>
              </div>
              {evalPin && (
                <button
                  type="button"
                  onClick={() => { setEvalPin(null); setEvalRoutes([]); }}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--hot)] hover:text-[var(--ink)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {evalPin && evalRoutes.length > 0 && (
              <div className="px-4 py-3 space-y-2">
                {people.filter((p) => p.lat !== 0 && p.lng !== 0).map((person) => {
                  const route = evalRoutes.find((r) => r.personId === person.id);
                  const seconds = route?.durationSeconds ?? 0;
                  return (
                    <div key={person.id} className="flex items-center gap-2">
                      <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: person.color }} />
                      <span className="text-[13px] text-[var(--ink)] flex-1 truncate">{person.label}</span>
                      <span className={`font-mono text-[13px] font-semibold tnum ${
                        seconds / 60 <= 20 ? 'text-[var(--good)]' : seconds / 60 <= 35 ? 'text-[var(--warn)]' : 'text-[var(--hot)]'
                      }`}>
                        {seconds > 0 ? formatTime(seconds) : '…'}
                      </span>
                    </div>
                  );
                })}
                <div className="flex justify-between pt-2 mt-1 border-t border-dashed border-[var(--rule)] font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                  <span>Avg <span className="font-semibold tnum text-[var(--ink)]">{formatTime(evalRoutes.reduce((s, r) => s + r.durationSeconds, 0) / evalRoutes.length)}</span></span>
                  <span>Max <span className="font-semibold tnum text-[var(--ink)]">{formatTime(Math.max(...evalRoutes.map((r) => r.durationSeconds)))}</span></span>
                </div>
              </div>
            )}

            {evalPin && evalRoutes.length === 0 && validCount > 0 && (
              <p className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Calculating routes…</p>
            )}

            {!evalPin && validCount === 0 && (
              <p className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Set people first, then tap the map</p>
            )}
          </div>
        </>
      )}
      <div className="h-8" />
    </>
  );

  return (
    <div className="h-[100dvh] w-screen overflow-hidden relative paper-grain">
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
          onSelectVenue={mode === 'find' ? handleSelectVenue : undefined}
        />
      </div>

      {/* Mobile floating header — visible on phones above the map */}
      <div className="lg:hidden absolute top-0 left-0 right-0 z-30 flex items-start justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        <div className="flex items-center gap-2 rounded-sm border border-[var(--rule)] bg-[var(--card)] px-2.5 py-1.5 shadow-[0_2px_12px_rgba(20,23,31,0.08)]">
          <MidpointLogo size={18} />
          <span className="font-display text-[16px] leading-none text-[var(--ink)]" style={{ fontVariationSettings: '"opsz" 144' }}>
            Midpoint
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--ink-muted)] border-l border-[var(--rule)] pl-2 ml-1">
            NYC
          </span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={openShare}
            className="rounded-sm border border-[var(--rule)] bg-[var(--card)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors shadow-[0_2px_12px_rgba(20,23,31,0.08)]"
          >
            Share
          </button>
          {sharePopover}
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex absolute inset-y-0 left-0 w-[420px] flex-col bg-[var(--paper)] border-r border-[var(--rule)] z-20 paper-grain">
        {/* Header */}
        <div className="px-6 pt-6 pb-5 border-b border-[var(--rule)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <MidpointLogo size={26} />
              <div>
                <h1 className="font-display text-[26px] leading-none text-[var(--ink)]" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}>
                  Midpoint
                </h1>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)] mt-1">
                  Meet in the middle · NYC
                </p>
              </div>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={openShare}
                className="rounded-sm border border-[var(--rule)] bg-[var(--card)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors"
              >
                Share ↗
              </button>
              {sharePopover}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-6 pb-12">
            {panelContent}
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <div
        ref={sheetRef}
        className="lg:hidden absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-[var(--paper)] paper-grain rounded-t-[14px] sheet-shadow border-t border-[var(--rule)]"
        style={{
          height: currentSheetHeight,
          transition: sheetDragY !== null ? 'none' : 'height 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
          maxHeight: '95dvh',
        }}
      >
        {/* Drag handle area */}
        <div
          className="shrink-0 touch-none select-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="flex justify-center pt-2 pb-1.5">
            <div className="grab-bar" />
          </div>
        </div>

        {/* Peek state — winning result summary, only visible when sheet is collapsed */}
        {sheetSnap === 'peek' && (
          <div className="shrink-0 px-5 pt-1 pb-3">
            {topResult ? (
              <button
                type="button"
                onClick={() => setSheetSnap('half')}
                className="w-full text-left anim-fade-up"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    The midpoint
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--signal)]">
                    Tap to expand ↑
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-[26px] leading-[1.05] text-[var(--ink)] truncate" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}>
                    {topResult.name}
                  </h2>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-[18px] font-semibold tnum text-[var(--ink)] leading-none">
                      {formatTime(topMax)}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)] mt-1">
                      max travel
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                  {topResult.neighborhood && <span>{topResult.neighborhood}</span>}
                  <span className="tnum">avg <span className="text-[var(--ink)] font-semibold">{formatTime(topAvg)}</span></span>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSheetSnap('half')}
                className="w-full text-left anim-fade-up"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    Get started
                  </span>
                </div>
                <h2 className="font-display text-[24px] leading-[1.1] text-[var(--ink)]" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}>
                  Where should you meet?
                </h2>
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--signal)]">
                  Add people → Tap to expand ↑
                </p>
              </button>
            )}
          </div>
        )}

        {/* Scrollable content — hidden in peek to save room */}
        <div className={`flex-1 overflow-y-auto overscroll-contain ${sheetSnap === 'peek' ? 'opacity-0 pointer-events-none' : 'opacity-100'} transition-opacity duration-200`}>
          <div className="flex flex-col gap-5 px-5 pt-1 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
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
      {/* Three converging paths meeting at a central marker — editorial monoline */}
      <circle cx="16" cy="16" r="15" stroke="#14171F" strokeWidth="1.25" fill="#FBF8EE" />
      <path d="M5 24 L16 16 L27 24" stroke="#14171F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 16 L16 5" stroke="#14171F" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.5" fill="#1F3FE0" stroke="#14171F" strokeWidth="1.25" />
    </svg>
  );
}

function LoadingStages({ currentStage }: { currentStage: string }) {
  const stages = [
    { key: 'prefilter', label: 'Pre-filter' },
    { key: 'travel_times', label: 'Travel times' },
    { key: 'scoring', label: 'Scoring' },
    { key: 'venues', label: 'Venues' },
  ];
  const currentIndex = stages.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex items-stretch gap-2">
      {stages.map((stage, i) => {
        const isActive = stage.key === currentStage;
        const isDone = i < currentIndex || currentStage === 'done';
        return (
          <div key={stage.key} className="flex-1 flex flex-col gap-1.5">
            <div className={`h-[3px] w-full transition-colors ${
              isDone ? 'bg-[var(--good)]' : isActive ? 'bg-[var(--ink)]' : 'bg-[var(--rule)]'
            }`} />
            <div className="flex items-center gap-1">
              <span className={`font-mono text-[8px] tnum ${
                isDone || isActive ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
              }`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={`font-mono text-[9px] uppercase tracking-[0.06em] truncate ${
                isDone ? 'text-[var(--good)]' : isActive ? 'text-[var(--ink)] font-semibold' : 'text-[var(--ink-muted)]'
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
