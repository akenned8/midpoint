# NYC Meeting Point Optimizer — Project Plan

---

## Architecture

### Pipeline

1. **Stage 1 — Heuristic Pre-Filter:** Score all 200 hotspots → enforce borough diversity minimums → deduplicate at 500m → output **top 16**
2. **Stage 2 — Routes API computeRouteMatrix:** 6 × 16 = 96 elements, single API call, with `departureTime` set to the user's chosen meetup time
3. **Stage 3 — Venue Discovery:** Top 3-5 scoring hotspots → Places Nearby Search
4. **Stage 4 — Visualization:** Mapbox map with travel time annotations (isochrones only for driving/walking/cycling modes via Mapbox; transit users get travel time labels only)

### Key Constraints

- **Google Routes API (not Distance Matrix — it's Legacy and unavailable for new projects)**
- **Transit mode is limited to 100 elements per request** on computeRouteMatrix, which is why the pre-filter outputs 16 candidates (6 people × 16 = 96)
- **Mapbox Isochrone API does not support transit** — only driving, walking, cycling. Transit users get travel time labels instead of isochrone polygons.
- **Next.js 16** with App Router (not 14 as in the original proposal — 14 has known security vulnerabilities)
- **Upstash Redis** via Vercel integration (Vercel KV is deprecated)

### Deduplication: 500m Radius

Candidates within 500m of a higher-ranked candidate are dropped before filling the 16 slots. This ensures each slot represents a meaningfully different location.

### Borough Diversity Floor

Before filling the 16 slots purely by score, reserve guaranteed slots for underrepresented boroughs:
1. Score all 200 hotspots using the heuristic
2. Reserve the top-scoring candidate from each borough that has at least one candidate scoring above a minimum viability threshold (e.g., within 2× the best score)
3. Fill remaining slots from the global ranked list, applying 500m dedup
4. This prevents a scenario where 5 Manhattan people cause all 16 candidates to cluster in Midtown — Brooklyn and Queens always get representation if they're remotely competitive

### Departure Time

The user selects when the meetup will happen, and this timestamp is passed to Google's `computeRouteMatrix` as `departureTime`. For transit, Google returns schedule-aware times for that exact moment. For driving, it uses historical traffic patterns for that day/time.

**Cache key implications:** Adding a time dimension to cache keys requires time bucketing to maintain reasonable hit rates:
- Transit: bucket to nearest 30-minute window
- Driving: bucket to nearest 1-hour window
- Walking/cycling: no time dimension needed
- Cache key format: `{mode}:{origin_geohash}:{dest_geohash}:{time_bucket}`

### Map + API Split

Mapbox GL JS for map rendering (vector tiles, custom styling, isochrone overlays, 50K free map loads/month). Google for geocoding, routing, and places. API route proxy pattern (`/api/isochrones`, `/api/times`, `/api/venues`) isolates both sets of API keys server-side.

### URL State Encoding

Use **lz-string** to compress session JSON before base64url encoding. Cuts URL length by ~40%. Full state for 6 people with departure time stays well under the 2,000-char cross-browser limit.

### The 200 Hotspot Corpus

Build programmatically:
1. Start with subway station locations (~472 stations). Each already satisfies the transit access requirement.
2. Filter to stations with nearby venue density using Google Places Nearby Search (≥3 venues within 400m).
3. Deduplicate at 500m and cap per borough: ~80 Manhattan, ~50 Brooklyn, ~35 Queens, ~20 Bronx, ~5 Staten Island, ~10 cross-borough hubs.
4. Manually review and adjust to remove obviously bad candidates (stations in industrial areas, etc.).

---

## Feature Ideas

### "Who's the Sacrifice?" Mode

When one person is a clear outlier (e.g., someone in Far Rockaway meeting 4 people in Manhattan), detect this and offer a split view:
- **With outlier included:** Best meeting spot is X, but Person D travels 55 minutes while everyone else travels 15-20.
- **Without outlier:** Best meeting spot shifts to Y, where everyone travels 10-15 minutes.
- **CTA:** "Should Person D take one for the team?" with a shareable link they can react to.

### "What If I Took the Subway Instead?" Toggle

When someone selects driving, show an inline comparison: "If you switched to transit, the optimal spot shifts from X to Y and everyone saves an average of 4 minutes." Single additional API call.

### Neighborhood Names Instead of Coordinates

Show the **neighborhood** in results. "The best spot is in **Prospect Heights**, near Atlantic Terminal" is more useful than coordinates. NYC users think in neighborhoods. Derive from the hotspot corpus (tag each hotspot with its neighborhood during curation) or via reverse geocoding.

### "Rematch" After Someone Drops Out

"Remove Person" button that instantly recomputes for the remaining group. Just re-run Stage 2 with fewer origins.

### MTA Real-Time Integration (Phase 2)

Ingest the subway alerts feed (not full real-time positions, just service alerts) to show warnings like "⚠️ A/C/E trains experiencing delays — Person B's travel time may be longer than estimated." Single HTTP GET to MTA's GTFS-RT feed.

### Progressive Disclosure UI

Show the #1 recommendation prominently with full travel time breakdown, then a "See more options" expander for 2-5, and a "Show all" for the full list.

### PWA / Add to Home Screen

Basic service worker + web manifest gets an "Add to Home Screen" prompt on iOS and Android.

---

## Build Plan

### Phase 0 — Scaffold

Initialize Next.js 16 project with App Router, TypeScript, Tailwind CSS, shadcn/ui. Set up folder structure, environment variable placeholders, install dependencies (mapbox-gl, @turf/turf, lz-string, @upstash/redis). Create `.env.example` and `DECISIONS.md`.

---

### Phase 1 — Data & Heuristic Engine

**Task 1.1 — Hotspot Corpus Generator**

Create a script `scripts/generate-hotspots.ts` that takes NYC subway station coordinates as input, queries Google Places Nearby Search to count restaurants/bars within 400m per station, filters to stations with ≥3 venues, deduplicates at 500m using Haversine distance, caps per borough (~80 MN, ~50 BK, ~35 QN, ~20 BX, ~5 SI, ~10 cross-borough), and outputs `data/hotspots-nyc.json`.

**Task 1.2 — Heuristic Transit Model**

Implement `lib/heuristic.ts` with:
- `estimateTransitTime(origin, destination, mode)` using Haversine distance, per-borough speed factors, borough-crossing penalties, hub gravity bonuses, and access/egress time
- `preFilterHotspots(people, hotspots, objectiveFunction, count=16)` that scores all hotspots, reserves the top-scoring candidate from each borough within 2× the best overall score (borough diversity floor), then fills remaining slots from the global ranked list with 500m dedup
- Mode-aware scoring: transit uses full model, driving uses congestion multiplier, walking/cycling uses pure distance/speed
- Unit tests including a borough diversity test

**Heuristic constants (best-guess priors, to be validated post-build):**

Borough speed factors: Manhattan 3.8×, Brooklyn 2.6×, Queens 2.4×, Bronx 2.5×, Staten Island 1.4×

Borough-crossing penalties (minutes): MN↔BK +8, MN↔QN +6, MN↔SI +32, BK↔QN +10, BK↔SI +38, QN↔SI +42

Hub gravity bonuses: Times Square 8pt, Union Square 7pt, Grand Central 6pt, Atlantic Terminal 5pt, and others as appropriate

**Task 1.3 — Scoring Functions**

Implement `lib/scoring.ts` with `sumOfSquares(times)`, `minimax(times)`, `blended(times, alpha)`, and `detectOutlier(times)`. Include edge case tests.

---

### Phase 2 — API Integration Layer

**Task 2.1 — Routes API Proxy**

`app/api/times/route.ts` — accepts origins (with modes), destinations, and departureTime. Groups origins by mode. Calls Google Routes API `computeRouteMatrix` with field mask `originIndex,destinationIndex,duration,distanceMeters,status,condition`. Implements Upstash Redis caching with time-bucketed geohash keys. TTLs: transit 15min, driving 20min, walking 6hr, cycling 6hr. Handles the 100-element transit limit.

**Task 2.2 — Places API Proxy**

`app/api/venues/route.ts` — calls Google Places Nearby Search (New) within 400m of given locations. Uses field masks for cost optimization. Caches with 24-hour TTL. Returns deduplicated venues ranked by composite score (proximity × 0.5 + rating × 0.3 + log(review_count) × 0.2).

**Task 2.3 — Isochrone Proxy**

`app/api/isochrones/route.ts` — calls Mapbox Isochrone API for driving/walking/cycling. Returns 204 for transit mode (not supported Phase 1). Caches with 30-min TTL. Returns GeoJSON FeatureCollection.

---

### Phase 3 — Core Optimization Flow

**Task 3.1 — Full Pipeline Orchestrator**

`lib/optimizer.ts` — accepts people array, objective function choice, and departureTime. Runs the full pipeline: heuristic pre-filter → Routes API → scoring → venue discovery. Includes error handling with graceful degradation.

**Task 3.2 — URL State Encoding**

`lib/url-state.ts` — encode/decode SessionState to/from URL using lz-string compression + base64url. SessionState includes people, objective, alpha, and departureTime. Round-trip tests, verify output stays under 1500 chars for 6 people.

---

### Phase 4 — Frontend UI

**Map Component** — Mapbox GL JS map centered on NYC with person markers (color-coded), hotspot markers, venue markers, and optional isochrone GeoJSON layers.

**Person Input Component** — address autocomplete (Google Places, restricted to NYC metro), transport mode selector (4 buttons with icons), editable label, remove button, color indicator. Compact enough for 6 on mobile.

**Results Display** — VenueCard with venue name, neighborhood, rating, price level, per-person travel time bar chart. TravelTimeGrid as N×M matrix with color-coded cells. Highlight the longest travel time per venue.

**Objective Slider** — fairest (minimax) to fastest (minimize mean), default at ~0.7. Recomputes ranking on already-fetched data, no new API call. Animated reordering.

**Departure Time Picker** — quick-select buttons: "Now", "Tonight (7pm)", "Tomorrow evening", "This Saturday afternoon". Custom option with date + time picker (15-min increments). Context-aware presets (don't show "This Saturday afternoon" if it's already Saturday evening). Triggers full re-query when changed.

**Main Page Assembly** — two modes via tabs: "Find the Spot" and "Evaluate a Spot". Share button copies URL with encoded state. Loading skeletons and error states.

---

### Phase 5 — Polish & Edge Cases

- Outlier detection and warning banner when one person's travel time is >2 standard deviations from the mean
- Staten Island warning on PersonInput card about ferry schedule variability
- Error handling: no venues found, no route available, address outside NYC, API rate limit hit
- Mobile responsiveness targeting 375px width (iPhone SE)

---

### Phase 6 — Testing & Deployment

**Heuristic Validation Script** — `scripts/validate-heuristic.ts` generates 100 random NYC origin pairs, runs heuristic pre-filter (top 16) and also computes Routes API matrix for all 200 hotspots, checks recall rate of true top-5 within heuristic top-16. Target: >95% recall.

**Deploy to Vercel** — configure environment variables, verify all API routes work in production.

---

## How to Use Claude Code Effectively

**Write a strong `CLAUDE.md` before coding.** Include the full TypeScript interfaces, key architectural decisions (16 candidates, 500m dedup, borough diversity, time-bucketed cache keys, Routes API not Distance Matrix), file layout, env var names, and testing instructions. This carries context between sessions.

**Build sequentially.** Types → heuristic/scoring → API layer → optimizer → UI → polish. The dependency chain is tight enough that parallelizing creates more merge overhead than it saves on a ~25-file project.

**One parallelization opportunity:** After types and heuristic are committed, the three API routes (`/api/times`, `/api/venues`, `/api/isochrones`) are independent and can be built in parallel worktrees. Merge back one at a time.

**Commit after every completed task.** Gives clean rollback points.

**Run `/compact` proactively** in longer sessions to keep context focused.

**The heuristic validation script is the highest-value task.** It tells you whether the core bet — 16 heuristic-filtered candidates capture the true optimum — actually works. Run it as early as possible after the API layer is working.

---

## Competitive Landscape

Existing competitors (MeetWays, Midpointr, Meet Halfway, Midway@, Findaspot, Roudle) are all general-purpose geographic midpoint finders. None have NYC-specific transit heuristics, a fairness/efficiency slider, isochrone visualization, mixed transport mode optimization, or borough-crossing penalty modeling.
