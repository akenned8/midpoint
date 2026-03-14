// Main app shell — "Find the Spot" and "Evaluate a Spot" modes
'use client';

import { useState, useCallback } from 'react';
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
import type { Person, Venue, SessionState } from '@/types';

// Lazy-load Map to avoid SSR issues with mapbox-gl
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

export default function Home() {
  const [people, setPeople] = useState<Person[]>([
    createPerson(0),
    createPerson(1),
  ]);
  const [alpha, setAlpha] = useState(0.7);
  const [departureTime, setDepartureTime] = useState('now');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [isochrones, setIsochrones] = useState<GeoJSON.FeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [outlierIndex, setOutlierIndex] = useState<number | null>(null);

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
      // Find the first person without coordinates and set their location
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

    setIsLoading(true);
    setOutlierIndex(null);

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
      });

      if (res.ok) {
        const data = await res.json();
        setVenues(data.venues ?? []);

        // Check for outlier
        if (data.rankings?.[0]?.times) {
          const idx = detectOutlier(data.rankings[0].times);
          setOutlierIndex(idx);
        }

        // Fetch isochrones for the top venue if someone uses a non-transit mode
        const nonTransit = validPeople.find((p) => p.mode !== 'transit');
        if (nonTransit && data.venues?.[0]) {
          const isoRes = await fetch('/api/isochrones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: data.venues[0].lat,
              lng: data.venues[0].lng,
              mode: nonTransit.mode === 'transit' ? 'driving' : nonTransit.mode,
              contours_minutes: [10, 20, 30],
            }),
          });
          if (isoRes.ok && isoRes.status !== 204) {
            setIsochrones(await isoRes.json());
          }
        }
      }
    } catch (err) {
      console.error('Optimize error:', err);
    } finally {
      setIsLoading(false);
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

  const validCount = people.filter((p) => p.lat !== 0 && p.lng !== 0).length;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      <div className="flex w-full flex-col gap-4 overflow-y-auto border-r p-4 lg:w-[420px] lg:shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Midpoint</h1>
          {venues.length > 0 && (
            <Button variant="outline" size="sm" onClick={shareLink}>
              Share
            </Button>
          )}
        </div>

        <Tabs defaultValue="find">
          <TabsList className="w-full">
            <TabsTrigger value="find" className="flex-1">
              Find the Spot
            </TabsTrigger>
            <TabsTrigger value="evaluate" className="flex-1">
              Evaluate a Spot
            </TabsTrigger>
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

            {/* Departure time */}
            <DepartureTimePicker value={departureTime} onChange={setDepartureTime} />

            {/* Objective slider */}
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

            {/* Outlier warning */}
            {outlierIndex !== null && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                <strong>{people[outlierIndex]?.label ?? 'Someone'}</strong> has a
                significantly longer travel time than the rest of the group.
              </div>
            )}

            {/* Results */}
            {venues.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium">
                  Top spots ({venues.length} found)
                </h2>
                {venues.slice(0, 5).map((venue, i) => (
                  <VenueCard
                    key={venue.placeId}
                    venue={venue}
                    people={people}
                    rank={i + 1}
                    isSelected={venue.placeId === selectedVenueId}
                    onClick={() => setSelectedVenueId(venue.placeId)}
                  />
                ))}

                {venues.length > 5 && (
                  <TravelTimeGrid
                    people={people}
                    venues={venues}
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
            {/* Evaluate mode will reuse the same people inputs */}
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
      <div className="flex-1">
        <Map
          people={people}
          venues={venues}
          isochrones={isochrones}
          selectedVenueId={selectedVenueId}
          onMapClick={handleMapClick}
        />
      </div>
    </div>
  );
}
