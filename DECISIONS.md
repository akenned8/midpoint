# Architectural Decisions Log

## 2026-03-14: Use Google Routes API, not Distance Matrix API
The Distance Matrix API was designated Legacy in March 2025 and cannot be enabled on new projects. We use the Routes API `computeRouteMatrix` endpoint instead. Transit mode is limited to 100 elements per request, which constrains our pre-filter to 16 candidates (6 people × 16 = 96 elements).

## 2026-03-14: Pre-filter outputs 16 candidates, not 50
Due to the 100-element transit limit on computeRouteMatrix. We use 500m Haversine deduplication and a borough diversity floor to ensure geographic spread in the 16 slots.

## 2026-03-14: No transit isochrones in Phase 1
Mapbox Isochrone API only supports driving, walking, and cycling. Transit users see travel time labels on the map instead of isochrone polygons. Transit isochrones may be added in Phase 2 via Geoapify or self-hosted OpenTripPlanner.

## 2026-03-14: Departure time is Phase 1
Users select when the meetup will happen. The timestamp is passed to Google's computeRouteMatrix as departureTime. Cache keys include time buckets (30min for transit, 1hr for driving) to maintain cache utility.

## 2026-03-14: Next.js 16 with App Router
Next.js 14 (from original proposal) is two major versions behind with known security vulnerabilities. Next.js 16 provides Turbopack, React Compiler support, and enhanced routing.

## 2026-03-14: Upstash Redis via Vercel integration
Vercel KV is deprecated. Using Upstash Redis directly through Vercel's integration panel.

## 2026-03-14: Heuristic constants are best-guess priors
Borough speed factors, crossing penalties, and hub bonuses are educated estimates, not fit to data. They will be validated post-build using the heuristic validation script against real Google Routes API results. Target: >95% recall of true top-5 within heuristic top-16.
