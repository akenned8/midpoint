# meetmidpoint

NYC meeting point optimizer. Finds the fairest place for a group to meet based on everyone's location and transport mode.

## Quick Reference

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npx tsc --noEmit     # Type check
```

## Tech Stack

- **Next.js 16** with App Router, React 19, TypeScript (strict mode)
- **Tailwind CSS v4** + **shadcn/ui** for components
- **Mapbox GL JS** for map rendering + isochrone overlays
- **Google Routes API** (`computeRouteMatrix`) for travel times — NOT Distance Matrix (Legacy, unavailable for new projects)
- **Google Places API** (New) for venue discovery
- **Mapbox Isochrone API** for driving/walking/cycling isochrones (no transit support)
- **Upstash Redis** for caching (not Vercel KV — deprecated)
- **lz-string** for URL state compression
- **@turf/turf** for geospatial operations

## Architecture

### Pipeline (4 stages)

1. **Heuristic Pre-Filter** — Score all 200 NYC hotspots → borough diversity floor → 500m dedup → **top 16 candidates**
2. **Routes API** — `computeRouteMatrix` with N people × 16 destinations (max 96 elements for transit's 100-element limit)
3. **Venue Discovery** — Google Places Nearby Search around top 3-5 scoring hotspots
4. **Visualization** — Mapbox map with travel time annotations and isochrone overlays

### Key Constraints

- Transit mode: 100 elements/request limit on computeRouteMatrix → max 16 candidates for 6 people
- Mapbox Isochrone: driving/walking/cycling ONLY — transit users get travel time labels
- Pre-filter dedup radius: 500m Haversine
- Borough diversity floor: reserve top candidate from each borough scoring within 2× best overall score
- Max 6 people

### Cache Strategy

Time-bucketed keys: `{mode}:{origin_geohash}:{dest_geohash}:{time_bucket}`
- Transit: 30-min buckets, 15-min TTL
- Driving: 1-hr buckets, 20-min TTL
- Walking/cycling: no time dimension, 6-hr TTL
- Venues: 24-hr TTL

## Project Structure

```
app/
  page.tsx                      # Main shell — "Find the Spot" / "Evaluate a Spot" modes
  layout.tsx                    # Root layout
  m/page.tsx                    # Shared link entry point
  api/
    isochrones/route.ts         # Mapbox Isochrone proxy
    optimize/route.ts           # Full pipeline endpoint (frontend entry point)
    times/route.ts              # Google Routes API proxy + cache
    venues/route.ts             # Google Places proxy + cache
components/
  Map.tsx                       # Mapbox GL JS map
  PersonInput.tsx               # Address autocomplete + transport mode
  VenueCard.tsx                 # Venue result card
  TravelTimeGrid.tsx            # N×M people × venues matrix
  ObjectiveSlider.tsx           # Fairness ↔ Efficiency slider
  DepartureTimePicker.tsx       # Meetup time selection
  ui/                           # shadcn/ui components
lib/
  heuristic.ts                  # estimateTransitTime, preFilterHotspots
  scoring.ts                    # minimax, sumOfSquares, blended, detectOutlier
  optimizer.ts                  # Full pipeline orchestrator
  cache.ts                      # Upstash Redis wrapper
  url-state.ts                  # lz-string encode/decode SessionState
  geo.ts                        # Haversine, geohash, borough detection, dedup
  utils.ts                      # shadcn/ui cn() utility
data/
  hotspots-nyc.json             # 200 curated NYC hotspots (static)
types/
  index.ts                      # All shared TypeScript interfaces
```

## Environment Variables

See `.env.example` for documentation. Required keys:
- `GOOGLE_MAPS_API_KEY` — server-side Routes API + Places API
- `NEXT_PUBLIC_MAPBOX_TOKEN` — client-side map rendering
- `MAPBOX_SECRET_TOKEN` — server-side Isochrone API
- `UPSTASH_REDIS_REST_URL` — Upstash Redis endpoint
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis auth

**Never commit `.env.local`** — it's gitignored.

## Types

All shared interfaces are in `types/index.ts`:
- `TransportMode`: 'transit' | 'driving' | 'walking' | 'cycling'
- `ObjectiveType`: 'fairness' | 'efficiency' | 'blended'
- `Person`: id, label, lat, lng, mode, color
- `Hotspot`: id, lat, lng, borough, neighborhood, nearestStation, venueCount
- `SessionState`: people, objective, alpha (0-1), departureTime (ISO8601 or 'now')
- `TravelTimeResult`: hotspotId, times (seconds[]), score
- `Venue`: placeId, name, lat, lng, rating, reviewCount, types, priceLevel, neighborhood, travelTimes

## Heuristic Constants

Borough speed factors: Manhattan 3.8×, Brooklyn 2.6×, Queens 2.4×, Bronx 2.5×, Staten Island 1.4×

Borough-crossing penalties (minutes): MN↔BK +8, MN↔QN +6, MN↔SI +32, BK↔QN +10, BK↔SI +38, QN↔SI +42

Hub gravity bonuses: Times Square 8pt, Union Square 7pt, Grand Central 6pt, Atlantic Terminal 5pt

These are best-guess priors — validate with `scripts/validate-heuristic.ts` targeting >95% recall of true top-5 within heuristic top-16.

## Build Phases

- **Phase 0** — Scaffold ✅
- **Phase 1** — Data & Heuristic Engine ✅ (geo utils, heuristic model, scoring functions — hotspot corpus pending)
- **Phase 2** — API Integration Layer ✅ (routes proxy, places proxy, isochrone proxy, cache)
- **Phase 3** — Core Optimization Flow ✅ (pipeline orchestrator, URL state encoding)
- **Phase 4** — Frontend UI ✅ (map, inputs, results, slider, time picker, shared page)
- **Phase 5** — Polish & Edge Cases (outlier detection, error handling, mobile)
- **Phase 6** — Testing & Deployment (heuristic validation, Vercel deploy)

Build sequentially. Commit after every completed task.

## Scoring Functions

- `minimax(times)` — minimize maximum travel time (fairness)
- `sumOfSquares(times)` — minimize sum of squared times (efficiency)
- `blended(times, alpha)` — interpolate: alpha=0 → pure efficiency, alpha=1 → pure fairness
- `detectOutlier(times)` — flag person >2σ from mean
