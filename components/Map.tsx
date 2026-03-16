// Mapbox GL JS map with markers, route lines, transit segments, and isochrone layers
'use client';

import { useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Person, Venue } from '@/types';

export interface RouteSegment {
  travelMode: 'WALK' | 'TRANSIT';
  durationSeconds: number;
  polyline: [number, number][];
  transitLineName?: string;
  transitLineColor?: string;
  transitLineShortName?: string;
}

export interface RouteFeature {
  personId: string;
  color: string;
  durationSeconds: number;
  geometry: GeoJSON.Feature<GeoJSON.LineString>;
  segments?: RouteSegment[];
}

interface MapProps {
  people: Person[];
  venues: Venue[];
  routes: RouteFeature[];
  isochrones: GeoJSON.FeatureCollection | null;
  selectedVenueId: string | null;
  evalPin?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  onSelectVenue?: (venueId: string) => void;
}

const NYC_CENTER: [number, number] = [-73.98, 40.74];
const NYC_ZOOM = 11.5;

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildVenuePopupHTML(venue: Venue): string {
  const stars = venue.rating > 0
    ? `<div style="display:flex;align-items:center;gap:3px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="#FF9500" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <span style="font-size:12px;font-weight:600;color:#1D1D1F;">${venue.rating.toFixed(1)}</span>
        ${venue.reviewCount > 0 ? `<span style="font-size:11px;color:#86868B;">(${venue.reviewCount.toLocaleString()})</span>` : ''}
      </div>`
    : '';

  const tags = venue.types.slice(0, 2).map((t) =>
    `<span style="display:inline-block;font-size:10px;font-weight:500;color:#86868B;background:#F5F5F7;border-radius:4px;padding:1px 5px;">${escapeHtml(t.replace(/_/g, ' '))}</span>`
  ).join(' ');

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;min-width:140px;max-width:200px;">
    <div style="font-size:13px;font-weight:600;color:#1D1D1F;line-height:1.3;margin-bottom:4px;">${escapeHtml(venue.name)}</div>
    ${stars}
    ${tags ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">${tags}</div>` : ''}
    ${venue.neighborhood ? `<div style="font-size:10px;color:#86868B;margin-top:4px;">${escapeHtml(venue.neighborhood)}</div>` : ''}
  </div>`;
}

export default function Map({
  people,
  venues,
  routes,
  isochrones,
  selectedVenueId,
  evalPin,
  onMapClick,
  onSelectVenue,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const venueMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const routeLabelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const evalPinMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Keep callbacks in refs so map event handlers stay current
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onSelectVenueRef = useRef(onSelectVenue);
  onSelectVenueRef.current = onSelectVenue;

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

  // Map click handler (for setting locations / eval pin)
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
          new mapboxgl.Popup({ offset: 18, className: 'midpoint-popup' }).setHTML(
            `<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;">
              <div style="font-size:13px;font-weight:600;color:#1D1D1F;">${escapeHtml(person.label)}</div>
              <div style="font-size:11px;color:#86868B;margin-top:1px;">${person.mode}</div>
            </div>`
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
        border-radius: ${isSelected ? '6px' : '50%'};
        background: ${isSelected ? '#f97316' : '#6366f1'};
        border: 2.5px solid white;
        box-shadow: 0 1px 6px rgba(0,0,0,0.25);
        cursor: pointer;
        transition: all 0.2s;
        z-index: ${isSelected ? 5 : 1};
      `;

      // Click to select venue (stop propagation so map click doesn't fire)
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectVenueRef.current?.(venue.placeId);
      });

      const popup = new mapboxgl.Popup({
        offset: isSelected ? 16 : 12,
        className: 'midpoint-popup',
        closeButton: false,
        maxWidth: '220px',
      }).setHTML(buildVenuePopupHTML(venue));

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([venue.lng, venue.lat])
        .setPopup(popup)
        .addTo(map);

      venueMarkersRef.current.push(marker);
    }
  }, [venues, selectedVenueId]);

  // Update route lines (with transit segment support)
  const updateRoutes = useCallback((routeData: RouteFeature[], currentPeople: Person[]) => {
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

        // Remove segment layers
        for (let j = 0; j < 20; j++) {
          const segLineId = `route-seg-${i}-${j}`;
          const segOutlineId = `route-seg-outline-${i}-${j}`;
          const segBorderId = `route-seg-border-${i}-${j}`;
          const segSourceId = `route-seg-src-${i}-${j}`;
          if (map.getLayer(segLineId)) map.removeLayer(segLineId);
          if (map.getLayer(segOutlineId)) map.removeLayer(segOutlineId);
          if (map.getLayer(segBorderId)) map.removeLayer(segBorderId);
          if (map.getSource(segSourceId)) map.removeSource(segSourceId);
        }
      }

      // Remove old label markers
      routeLabelMarkersRef.current.forEach((m) => m.remove());
      routeLabelMarkersRef.current = [];

      if (routeData.length === 0) return;

      routeData.forEach((route, i) => {
        if (route.segments && route.segments.length > 0) {
          renderTransitSegments(map, route, i);
        } else {
          renderSimpleRoute(map, route, i);
        }

        // Total travel time label — positioned near origin, visually distinct
        if (route.durationSeconds > 0) {
          const person = currentPeople.find((p) => p.id === route.personId);
          // Place label near the start of route (offset toward the route)
          const coords = route.geometry.geometry.coordinates;
          // Use ~15% along the route rather than midpoint
          const labelIdx = Math.max(0, Math.floor(coords.length * 0.15));
          const labelCoord = coords[labelIdx];

          if (labelCoord) {
            const el = document.createElement('div');
            el.style.cssText = `
              display: flex;
              align-items: center;
              gap: 3px;
              background: white;
              color: ${route.color};
              padding: 3px 8px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: 700;
              white-space: nowrap;
              box-shadow: 0 1px 4px rgba(0,0,0,0.15);
              border: 2px solid ${route.color};
              pointer-events: none;
              font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
            `;
            // Clock icon + duration
            el.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${route.color}" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${formatDuration(route.durationSeconds)}`;

            const labelMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([labelCoord[0], labelCoord[1]])
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

  function renderSimpleRoute(map: mapboxgl.Map, route: RouteFeature, i: number) {
    const sourceId = `route-${i}`;
    const outlineId = `route-outline-${i}`;
    const lineId = `route-line-${i}`;

    map.addSource(sourceId, {
      type: 'geojson',
      data: route.geometry,
    });

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
  }

  function renderTransitSegments(map: mapboxgl.Map, route: RouteFeature, routeIdx: number) {
    route.segments!.forEach((segment, segIdx) => {
      if (segment.polyline.length < 2) return;

      const sourceId = `route-seg-src-${routeIdx}-${segIdx}`;
      const borderId = `route-seg-border-${routeIdx}-${segIdx}`;
      const outlineId = `route-seg-outline-${routeIdx}-${segIdx}`;
      const lineId = `route-seg-${routeIdx}-${segIdx}`;

      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: segment.polyline,
        },
      };

      map.addSource(sourceId, { type: 'geojson', data: geojson });

      if (segment.travelMode === 'WALK') {
        // Walking segments: dashed line in the person's color
        map.addLayer({
          id: outlineId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 5,
            'line-opacity': 0.6,
          },
        });

        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': route.color,
            'line-width': 2.5,
            'line-opacity': 0.55,
            'line-dasharray': [2, 3],
          },
        });
      } else {
        // Transit segments: person-color border → white gap → transit-color core
        const lineColor = segment.transitLineColor || route.color;

        // Outer border in person's color (identifies whose route this is)
        map.addLayer({
          id: borderId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': route.color,
            'line-width': 9,
            'line-opacity': 0.7,
          },
        });

        // White gap between person border and transit color
        map.addLayer({
          id: outlineId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 7,
            'line-opacity': 0.9,
          },
        });

        // Inner core in transit line color
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': lineColor,
            'line-width': 4.5,
            'line-opacity': 0.9,
          },
        });

        // Transit line name label — small circle badge at segment midpoint
        if (segment.transitLineShortName || segment.transitLineName) {
          const midIdx = Math.floor(segment.polyline.length / 2);
          const midCoord = segment.polyline[midIdx];
          if (midCoord) {
            const displayName = segment.transitLineShortName || segment.transitLineName || '';
            const isShort = displayName.length <= 2;
            const el = document.createElement('div');
            el.style.cssText = `
              display: flex;
              align-items: center;
              justify-content: center;
              background: ${lineColor};
              color: white;
              width: ${isShort ? '20px' : 'auto'};
              height: 20px;
              padding: ${isShort ? '0' : '0 6px'};
              border-radius: ${isShort ? '50%' : '10px'};
              font-size: 10px;
              font-weight: 700;
              white-space: nowrap;
              box-shadow: 0 1px 3px rgba(0,0,0,0.25);
              pointer-events: none;
              letter-spacing: 0.2px;
              font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
            `;
            el.textContent = displayName;

            const labelMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([midCoord[0], midCoord[1]])
              .addTo(map);

            routeLabelMarkersRef.current.push(labelMarker);
          }
        }
      }
    });
  }

  // Keep people ref for route labels
  const peopleRef = useRef(people);
  peopleRef.current = people;

  useEffect(() => {
    updateRoutes(routes, peopleRef.current);
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

  // Update eval pin marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    evalPinMarkerRef.current?.remove();
    evalPinMarkerRef.current = null;

    if (!evalPin) return;

    const el = document.createElement('div');
    el.style.cssText = `
      width: 36px; height: 36px; border-radius: 50%;
      background: #FF9500; border: 3px solid white;
      box-shadow: 0 2px 10px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 10;
    `;
    el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

    evalPinMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat([evalPin.lng, evalPin.lat])
      .addTo(map);
  }, [evalPin]);

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
