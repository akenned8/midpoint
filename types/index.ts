export type TransportMode = 'transit' | 'driving' | 'walking' | 'cycling';

export type ObjectiveType = 'fairness' | 'efficiency' | 'blended';

export interface Person {
  id: string;
  label: string;
  lat: number;
  lng: number;
  mode: TransportMode;
  color: string;
}

export interface Hotspot {
  id: string;
  lat: number;
  lng: number;
  borough: 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten_island';
  neighborhood: string;
  nearestStation: string;
  venueCount: number;
}

export interface SessionState {
  people: Person[];
  objective: ObjectiveType;
  alpha: number;
  departureTime: string;
}

export interface TravelTimeResult {
  hotspotId: string;
  times: number[];
  score: number;
}

export interface Venue {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  types: string[];
  priceLevel?: number;
  neighborhood: string;
  travelTimes: number[];
}
