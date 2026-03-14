// Mapbox GL JS map with markers, route lines, and isochrone layers
'use client';

import { useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Person, Venue } from '@/types';

export interface RouteFeature {
  personId: string;
  color: string;
  durationSeconds: number;
  geometry: GeoJSON.Feature<GeoJSON.LineString>;
}

interface MapProps {
  people: Person[];
  venues: Venue[];
  routes: RouteFeature[];
  isochrones: GeoJSON.FeatureCollection | null;
  selectedVenueId: string | null;
  onMapClick?: (lat: number, lng: number) => void;
}

const NYC_CENTER: [number, number] = [-73.98, 40.74];
const NYC_ZOOM = 11.5;

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export default function Map({
  people,
  venues,
  routes,
  isochrones,
  selectedVenueId,
  onMapClick,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const venueMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const routeLabelMarkersRef = useRef<mapboxgl.Marker[]>([]);

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
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep click handler up to date
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, []);

  // Update person markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const person of people) {
      if (!person.lat || !person.lng) continue;

      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px; height: 32px; border-radius: 50%;
        background: ${person.color}; border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 13px; font-weight: bold;
        z-index: 10;
      `;
      el.textContent = person.label.charAt(0).toUpperCase();

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([person.lng, person.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 18 }).setHTML(
            `<strong>${person.label}</strong><br/>${person.mode}`
          )
        )
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [people]);

  // Update venue markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    venueMarkersRef.current.forEach((m) => m.remove());
    venueMarkersRef.current = [];

    for (const venue of venues) {
      const isSelected = venue.placeId === selectedVenueId;

      const el = document.createElement('div');
      el.style.cssText = `
        width: ${isSelected ? 24 : 16}px;
        height: ${isSelected ? 24 : 16}px;
        border-radius: ${isSelected ? '4px' : '50%'};
        background: ${isSelected ? '#f97316' : '#6366f1'};
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        cursor: pointer;
        transition: all 0.2s;
        z-index: ${isSelected ? 5 : 1};
      `;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([venue.lng, venue.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setHTML(
            `<strong>${venue.name}</strong><br/>` +
            `${venue.rating ? `★ ${venue.rating}` : ''} ` +
            `${venue.types.slice(0, 2).join(', ')}`
          )
        )
        .addTo(map);

      venueMarkersRef.current.push(marker);
    }
  }, [venues, selectedVenueId]);

  // Update route lines
  const updateRoutes = useCallback((routeData: RouteFeature[]) => {
    const map = mapRef.current;
    if (!map) return;

    const doUpdate = () => {
      // Remove existing route layers and sources
      for (let i = 0; i < 10; i++) {
        const lineId = `route-line-${i}`;
        const outlineId = `route-outline-${i}`;
        const sourceId = `route-${i}`;
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getLayer(outlineId)) map.removeLayer(outlineId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }

      // Remove old label markers
      routeLabelMarkersRef.current.forEach((m) => m.remove());
      routeLabelMarkersRef.current = [];

      if (routeData.length === 0) return;

      // Add each route as a separate source/layer for individual colors
      routeData.forEach((route, i) => {
        const sourceId = `route-${i}`;
        const outlineId = `route-outline-${i}`;
        const lineId = `route-line-${i}`;

        map.addSource(sourceId, {
          type: 'geojson',
          data: route.geometry,
        });

        // White outline for contrast
        map.addLayer({
          id: outlineId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 0.8,
          },
        });

        // Colored route line
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': route.color,
            'line-width': 3.5,
            'line-opacity': 0.85,
          },
        });

        // Add travel time label at midpoint of the route
        if (route.durationSeconds > 0) {
          const coords = route.geometry.geometry.coordinates;
          const midIdx = Math.floor(coords.length / 2);
          const midCoord = coords[midIdx];

          if (midCoord) {
            const el = document.createElement('div');
            el.style.cssText = `
              background: ${route.color};
              color: white;
              padding: 2px 6px;
              border-radius: 10px;
              font-size: 11px;
              font-weight: 600;
              white-space: nowrap;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              pointer-events: none;
            `;
            el.textContent = formatDuration(route.durationSeconds);

            const labelMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([midCoord[0], midCoord[1]])
              .addTo(map);

            routeLabelMarkersRef.current.push(labelMarker);
          }
        }
      });
    };

    if (map.isStyleLoaded()) {
      doUpdate();
    } else {
      map.on('load', doUpdate);
    }
  }, []);

  useEffect(() => {
    updateRoutes(routes);
  }, [routes, updateRoutes]);

  // Update isochrone layers
  const updateIsochrones = useCallback((geojson: GeoJSON.FeatureCollection | null) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

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
          10, '#4ade80', 20, '#facc15', 30, '#f87171',
        ],
        'fill-opacity': 0.12,
      },
    });

    map.addLayer({
      id: 'isochrone-outline',
      type: 'line',
      source: 'isochrone',
      paint: {
        'line-color': [
          'interpolate', ['linear'], ['get', 'contour'],
          10, '#22c55e', 20, '#eab308', 30, '#ef4444',
        ],
        'line-width': 1.5,
        'line-opacity': 0.5,
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

  // Fit bounds
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
      className="h-full w-full rounded-lg"
      style={{ minHeight: '400px' }}
    />
  );
}
