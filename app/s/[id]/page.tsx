// Collaborative session page — participants claim a person slot and set their location
'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import dynamic from 'next/dynamic';
import PersonInput from '@/components/PersonInput';
import VenueCard from '@/components/VenueCard';
import TravelTimeGrid from '@/components/TravelTimeGrid';
import ObjectiveSlider from '@/components/ObjectiveSlider';
import DepartureTimePicker from '@/components/DepartureTimePicker';
import { detectOutlier } from '@/lib/scoring';
import type { Person, Venue, TravelTimeResult } from '@/types';
import type { RouteFeature } from '@/components/Map';
import type { Session, SessionResults } from '@/lib/sessions';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

const POLL_INTERVAL = 3000;

// Persistent browser ID for claiming person slots
function getBrowserId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('midpoint-browser-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('midpoint-browser-id', id);
  }
  return id;
}

function getClaimedIndex(sessionId: string): number | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(`midpoint-claim-${sessionId}`);
  return v != null ? parseInt(v, 10) : null;
}

function setClaimedIndex(sessionId: string, index: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`midpoint-claim-${sessionId}`, String(index));
}

interface CandidateDetail {
  hotspotId: string;
  neighborhood: string;
  borough: string;
  lat: number;
  lng: number;
}

function MidpointLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#007AFF" fillOpacity="0.08" />
      <path d="M8 24L16 12L24 24" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="12" r="3.5" fill="#007AFF" />
      <circle cx="16" cy="12" r="1.5" fill="white" />
    </svg>
  );
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myIndex, setMyIndex] = useState<number | null>(null);
  const [routes, setRoutes] = useState<RouteFeature[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [outlierIndex, setOutlierIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const lastUpdatedAt = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bottom sheet state (mobile)
  type SheetSnap = 'peek' | 'half' | 'full';
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [sheetDragY, setSheetDragY] = useState<number | null>(null);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ y: number; startHeight: number } | null>(null);

  const SNAP_HEIGHTS: Record<SheetSnap, number> = { peek: 160, half: 50, full: 92 };

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
    const newH = Math.max(100, Math.min(window.innerHeight * 0.95, dragStartRef.current.startHeight + delta));
    setSheetDragY(newH);
    setSheetHeight(newH);
  }, []);

  const onDragEnd = useCallback(() => {
    dragStartRef.current = null;
    setSheetDragY(null);
    if (sheetHeight === null) return;
    const vh = window.innerHeight;
    const dists = [
      { snap: 'peek' as SheetSnap, d: Math.abs(sheetHeight - SNAP_HEIGHTS.peek) },
      { snap: 'half' as SheetSnap, d: Math.abs(sheetHeight - vh * SNAP_HEIGHTS.half / 100) },
      { snap: 'full' as SheetSnap, d: Math.abs(sheetHeight - vh * SNAP_HEIGHTS.full / 100) },
    ];
    dists.sort((a, b) => a.d - b.d);
    setSheetSnap(dists[0].snap);
    setSheetHeight(null);
  }, [sheetHeight]);

  const currentSheetHeight = sheetDragY ?? getSnapHeight(sheetSnap);

  // Fetch session initially
  useEffect(() => {
    fetchSession();
    const saved = getClaimedIndex(sessionId);
    if (saved != null) setMyIndex(saved);
  }, [sessionId]);

  // Poll for updates
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchSession(true);
    }, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId]);

  const fetchSession = async (silent = false) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) {
        if (res.status === 404) setError('Session not found or expired');
        else setError('Failed to load session');
        setLoading(false);
        return;
      }
      const data: Session = await res.json();

      // Only update if data actually changed (avoid flickering)
      if (data.updatedAt !== lastUpdatedAt.current) {
        lastUpdatedAt.current = data.updatedAt;
        setSession(data);
      }
      setLoading(false);
    } catch {
      if (!silent) setError('Failed to load session');
      setLoading(false);
    }
  };

  const patchSession = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data: Session = await res.json();
        lastUpdatedAt.current = data.updatedAt;
        setSession(data);
      }
    } catch {}
  };

  // Claim a person slot
  const claimPerson = (index: number) => {
    setMyIndex(index);
    setClaimedIndex(sessionId, index);
  };

  // Update my person's data
  const updateMyPerson = (person: Person) => {
    if (myIndex == null || !session) return;
    // Optimistic local update
    const updated = { ...session, people: [...session.people] };
    updated.people[myIndex] = person;
    setSession(updated);
    // Persist to Redis
    patchSession({ personIndex: myIndex, person });
  };

  // Update session settings
  const updateSettings = (changes: Record<string, unknown>) => {
    if (!session) return;
    setSession({ ...session, ...changes, results: null } as Session);
    patchSession({ ...changes, clearResults: true });
  };

  // Map click — set my location
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (myIndex == null || !session) return;
    const person = session.people[myIndex];
    if (person.lat !== 0 && person.lng !== 0) return; // already set
    const updated = { ...person, lat, lng };
    updateMyPerson(updated);
  }, [myIndex, session]);

  // Run optimization
  const findMidpoint = async () => {
    if (!session) return;
    const validPeople = session.people.filter((p) => p.lat !== 0 && p.lng !== 0);
    if (validPeople.length < 2) return;

    setIsOptimizing(true);
    setLoadingStage('prefilter');
    setOutlierIndex(null);

    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          people: validPeople,
          objective: session.objective,
          alpha: session.alpha,
          departureTime: session.departureTime,
        }),
      });

      if (!res.ok) { setIsOptimizing(false); return; }

      const reader = res.body?.getReader();
      if (!reader) { setIsOptimizing(false); return; }

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
            if (msg.type === 'stage') setLoadingStage(msg.stage);
            if (msg.type === 'result') {
              const results: SessionResults = {
                rankings: msg.rankings,
                venues: msg.venues,
                candidateDetails: msg.candidateDetails,
                usedHeuristic: msg.usedHeuristic ?? false,
              };

              // Store results in Redis so all participants see them
              await patchSession({ results });

              if (msg.rankings?.[0]?.times) {
                setOutlierIndex(detectOutlier(msg.rankings[0].times));
              }

              // Fetch routes to top result
              const topVenue = msg.venues?.[0];
              const topCandidate = msg.candidateDetails?.find(
                (c: CandidateDetail) => c.hotspotId === msg.rankings?.[0]?.hotspotId
              );
              const dest = topVenue ?? topCandidate;
              if (dest) {
                setSelectedVenueId(topVenue?.placeId ?? topCandidate?.hotspotId ?? null);
                fetchRoutes(validPeople, dest, session.departureTime);
              }
            }
          } catch {}
        }
      }
    } catch {} finally {
      setIsOptimizing(false);
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
      if (res.ok) {
        const data = await res.json();
        setRoutes(data.routes ?? []);
      }
    } catch {}
  };

  const handleSelectVenue = (venueId: string) => {
    if (!session) return;
    setSelectedVenueId(venueId);
    const items = buildDisplayItems();
    const venue = items.find((v) => v.placeId === venueId);
    if (venue) {
      const validPeople = session.people.filter((p) => p.lat !== 0 && p.lng !== 0);
      fetchRoutes(validPeople, { lat: venue.lat, lng: venue.lng }, session.departureTime);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Build display items from session results
  function buildDisplayItems(): Venue[] {
    if (!session?.results) return [];
    const { rankings, venues, candidateDetails } = session.results;
    if (rankings.length === 0) return [];

    const validPeople = session.people.filter((p) => p.lat !== 0 && p.lng !== 0);
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

  const formatTime = (seconds: number) => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  };

  // Loading / error states
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <MidpointLogo size={28} />
            <h1 className="text-[20px] font-semibold text-[#1D1D1F]">Midpoint</h1>
          </div>
          <p className="text-[13px] text-[#86868B] animate-pulse">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <MidpointLogo size={28} />
            <h1 className="text-[20px] font-semibold text-[#1D1D1F]">Midpoint</h1>
          </div>
          <p className="text-[13px] text-[#86868B] mt-2">{error ?? 'Session not found'}</p>
          <a href="/" className="mt-4 inline-block text-[13px] font-medium text-[#007AFF]">
            Start a new session
          </a>
        </div>
      </div>
    );
  }

  const displayItems = buildDisplayItems();
  const hasResults = displayItems.length > 0;
  const validCount = session.people.filter((p) => p.lat !== 0 && p.lng !== 0).length;
  const allSet = validCount === session.people.length;

  // Person list with claim UI
  const personList = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[#1D1D1F]">People</span>
        <span className="text-[11px] text-[#86868B]">{validCount}/{session.people.length} locations set</span>
      </div>
      {session.people.map((person, i) => {
        const isMine = myIndex === i;
        const hasLocation = person.lat !== 0 && person.lng !== 0;

        if (isMine) {
          // Full editable input for claimed person
          return (
            <div key={person.id} className="relative">
              <div className="absolute -top-1 right-2 z-10">
                <span className="text-[9px] font-semibold text-[#007AFF] bg-[#007AFF]/8 rounded-full px-2 py-0.5">You</span>
              </div>
              <PersonInput
                person={person}
                onUpdate={(p) => updateMyPerson(p)}
                onRemove={() => {}}
                canRemove={false}
              />
            </div>
          );
        }

        // Not claimed by me — show status or claim button
        return (
          <div
            key={person.id}
            className={`rounded-xl p-3 transition-all ${
              hasLocation
                ? 'bg-[#F5F5F7]'
                : 'bg-[#F5F5F7] border-2 border-dashed border-black/[0.08] cursor-pointer hover:border-[#007AFF]/30'
            }`}
            onClick={() => {
              if (myIndex == null && !hasLocation) claimPerson(i);
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-[10px] w-[10px] shrink-0 rounded-full"
                style={{ backgroundColor: person.color }}
              />
              <span className="text-[13px] font-semibold text-[#1D1D1F]">{person.label}</span>
              {hasLocation ? (
                <span className="ml-auto flex items-center gap-1 text-[11px] text-[#34C759]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Location set
                </span>
              ) : myIndex == null ? (
                <span className="ml-auto text-[11px] font-medium text-[#007AFF]">
                  This is me
                </span>
              ) : (
                <span className="ml-auto text-[11px] text-[#86868B]">
                  Waiting...
                </span>
              )}
            </div>
            {hasLocation && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#86868B]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="14" rx="2" /><path d="M4 11h16" /><path d="M12 3v8" /><circle cx="8" cy="21" r="1" /><circle cx="16" cy="21" r="1" /><path d="M8 17v4" /><path d="M16 17v4" />
                </svg>
                {person.mode}
              </div>
            )}
          </div>
        );
      })}
      {myIndex == null && (
        <p className="text-[11px] text-[#86868B] pl-0.5">Tap your name above to set your location.</p>
      )}
      {myIndex != null && !session.people[myIndex]?.lat && (
        <p className="text-[11px] text-[#86868B] pl-0.5">Search an address or tap the map to set your location.</p>
      )}
    </div>
  );

  // Panel content
  const panelContent = (
    <>
      {personList}

      <div className="h-px bg-black/[0.04]" />

      <DepartureTimePicker
        value={session.departureTime}
        onChange={(v) => updateSettings({ departureTime: v })}
      />
      <ObjectiveSlider
        alpha={session.alpha}
        onChange={(a) => updateSettings({ alpha: a })}
      />

      <button
        className="w-full h-[44px] rounded-xl bg-[#007AFF] text-[15px] font-medium text-white hover:bg-[#0071EB] disabled:opacity-40 disabled:pointer-events-none transition-colors active:opacity-80"
        onClick={findMidpoint}
        disabled={validCount < 2 || isOptimizing}
      >
        {isOptimizing ? 'Finding...' : validCount < 2
          ? `Waiting for ${2 - validCount} more location${2 - validCount > 1 ? 's' : ''}`
          : allSet ? 'Find the Spot' : `Find the Spot (${validCount}/${session.people.length} ready)`}
      </button>

      {isOptimizing && (
        <div className="rounded-xl bg-white border border-black/[0.06] p-4">
          <p className="text-[12px] text-[#86868B] animate-pulse">
            {loadingStage === 'prefilter' && 'Analyzing locations...'}
            {loadingStage === 'travel_times' && 'Fetching live travel times...'}
            {loadingStage === 'scoring' && 'Scoring candidates...'}
            {loadingStage === 'venues' && 'Finding nearby spots...'}
          </p>
        </div>
      )}

      {session.results?.usedHeuristic && hasResults && (
        <div className="rounded-xl bg-[#5856D6]/8 border border-[#5856D6]/15 px-3.5 py-2.5 text-[12px] text-[#5856D6]">
          Times are estimates. Live data requires a Google Maps API key.
        </div>
      )}

      {outlierIndex !== null && (
        <div className="rounded-xl bg-[#FF9500]/8 border border-[#FF9500]/15 px-3.5 py-2.5 text-[13px] text-[#FF9500]">
          <span className="font-semibold">{session.people[outlierIndex]?.label ?? 'Someone'}</span> has a significantly longer commute.
        </div>
      )}

      {hasResults && !isOptimizing && (
        <div className="space-y-2.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[15px] font-semibold text-[#1D1D1F]">Results</h2>
            <span className="text-[12px] text-[#86868B]">{displayItems.length} spots found</span>
          </div>
          {displayItems.slice(0, 5).map((item, i) => (
            <VenueCard
              key={item.placeId}
              venue={item}
              people={session.people.filter((p) => p.lat !== 0 && p.lng !== 0)}
              rank={i + 1}
              isSelected={item.placeId === selectedVenueId}
              onClick={() => handleSelectVenue(item.placeId)}
            />
          ))}
          {displayItems.length > 5 && (
            <TravelTimeGrid
              people={session.people.filter((p) => p.lat !== 0 && p.lng !== 0)}
              venues={displayItems}
              selectedVenueId={selectedVenueId}
              onSelectVenue={handleSelectVenue}
            />
          )}
        </div>
      )}

      <div className="h-8" />
    </>
  );

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Map */}
      <div className="absolute inset-0">
        <Map
          people={session.people}
          venues={displayItems}
          routes={routes}
          isochrones={null}
          selectedVenueId={selectedVenueId}
          onMapClick={handleMapClick}
          onSelectVenue={handleSelectVenue}
        />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex absolute inset-y-0 left-0 w-[400px] flex-col bg-[#FBFBFD]/95 backdrop-blur-xl border-r border-black/[0.06] z-20">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <div className="flex items-center gap-2">
            <MidpointLogo size={24} />
            <h1 className="text-[20px] font-semibold tracking-tight text-[#1D1D1F]">Midpoint</h1>
          </div>
          <button
            onClick={copyLink}
            className="flex items-center gap-1 text-[13px] font-medium text-[#007AFF] hover:text-[#0071EB] transition-colors"
          >
            {copied ? 'Copied!' : 'Share'}
            {!copied && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-5">
            {panelContent}
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <div
        className="lg:hidden absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-[#FBFBFD]/[0.97] backdrop-blur-2xl rounded-t-2xl shadow-[0_-4px_30px_rgba(0,0,0,0.08)]"
        style={{
          height: currentSheetHeight,
          transition: sheetDragY !== null ? 'none' : 'height 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
          maxHeight: '95vh',
        }}
      >
        <div
          className="shrink-0 touch-none select-none"
          onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
          onTouchMove={(e) => onDragMove(e.touches[0].clientY)}
          onTouchEnd={() => onDragEnd()}
        >
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-[5px] w-9 rounded-full bg-black/15" />
          </div>
          <div className="flex items-center justify-between px-5 pb-3">
            <div className="flex items-center gap-1.5">
              <MidpointLogo size={20} />
              <h1 className="text-[17px] font-semibold tracking-tight text-[#1D1D1F]">Midpoint</h1>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={copyLink} className="text-[13px] font-medium text-[#007AFF]">
                {copied ? 'Copied!' : 'Share'}
              </button>
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
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-4 px-5 pb-8">
            {panelContent}
          </div>
        </div>
      </div>
    </div>
  );
}
