// Mapbox GL JS map with marker and isochrone layer support
'use client';

import { useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Person, Venue } from '@/types';

interface MapProps {
  people: Person[];
  venues: Venue[];
  isochrones: GeoJSON.FeatureCollection | null;
  selectedVenueId: string | null;
  onMapClick?: (lat: number, lng: number) => void;
}

// NYC center
const NYC_CENTER: [number, number] = [-73.98, 40.74];
const NYC_ZOOM = 11.5;

export default function Map({
  people,
  venues,
  isochrones,
  selectedVenueId,
  onMapClick,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error('Missing NEXT_PUBLIC_MAPBOX_TOKEN');
      return;
    }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: NYC_CENTER,
      zoom: NYC_ZOOM,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('click', (e) => {
      onMapClick?.(e.lngLat.lat, e.lngLat.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update person markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const person of people) {
      if (!person.lat || !person.lng) continue;

      const el = document.createElement('div');
      el.className = 'person-marker';
      el.style.cssText = `
        width: 28px; height: 28px; border-radius: 50%;
        background: ${person.color}; border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 12px; font-weight: bold;
      `;
      el.textContent = person.label.charAt(0).toUpperCase();

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([person.lng, person.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 15 }).setHTML(
            `<strong>${person.label}</strong><br/>${person.mode}`
          )
        )
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [people]);

  // Update venue markers
  const venueMarkersRef = useRef<mapboxgl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    venueMarkersRef.current.forEach((m) => m.remove());
    venueMarkersRef.current = [];

    for (const venue of venues) {
      const isSelected = venue.placeId === selectedVenueId;
      const el = document.createElement('div');
      el.style.cssText = `
        width: ${isSelected ? 20 : 14}px;
        height: ${isSelected ? 20 : 14}px;
        border-radius: 50%;
        background: ${isSelected ? '#f97316' : '#6366f1'};
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        cursor: pointer;
        transition: all 0.15s;
      `;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([venue.lng, venue.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 10 }).setHTML(
            `<strong>${venue.name}</strong><br/>` +
            `${venue.rating ? `⭐ ${venue.rating}` : ''} ` +
            `${venue.types.slice(0, 2).join(', ')}`
          )
        )
        .addTo(map);

      venueMarkersRef.current.push(marker);
    }
  }, [venues, selectedVenueId]);

  // Update isochrone layers
  const updateIsochrones = useCallback((geojson: GeoJSON.FeatureCollection | null) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // Remove existing isochrone layers
    if (map.getLayer('isochrone-fill')) map.removeLayer('isochrone-fill');
    if (map.getLayer('isochrone-outline')) map.removeLayer('isochrone-outline');
    if (map.getSource('isochrone')) map.removeSource('isochrone');

    if (!geojson || !geojson.features?.length) return;

    map.addSource('isochrone', { type: 'geojson', data: geojson });

    map.addLayer({
      id: 'isochrone-fill',
      type: 'fill',
      source: 'isochrone',
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['get', 'contour'],
          10, '#4ade80',
          20, '#facc15',
          30, '#f87171',
        ],
        'fill-opacity': 0.15,
      },
    });

    map.addLayer({
      id: 'isochrone-outline',
      type: 'line',
      source: 'isochrone',
      paint: {
        'line-color': [
          'interpolate', ['linear'], ['get', 'contour'],
          10, '#22c55e',
          20, '#eab308',
          30, '#ef4444',
        ],
        'line-width': 1.5,
        'line-opacity': 0.6,
      },
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded()) {
      updateIsochrones(isochrones);
    } else {
      map.on('load', () => updateIsochrones(isochrones));
    }
  }, [isochrones, updateIsochrones]);

  // Fit bounds when people change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || people.filter((p) => p.lat && p.lng).length < 2) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const p of people) {
      if (p.lat && p.lng) bounds.extend([p.lng, p.lat]);
    }
    for (const v of venues) {
      bounds.extend([v.lng, v.lat]);
    }
    map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
  }, [people, venues]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[42vh] w-full lg:min-h-0 lg:rounded-lg"
    />
  );
}
