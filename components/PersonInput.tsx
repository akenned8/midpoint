// Address autocomplete + transport mode selector per person
'use client';

import { useState, useRef } from 'react';
import type { Person, TransportMode } from '@/types';

interface PersonInputProps {
  person: Person;
  onUpdate: (person: Person) => void;
  onRemove: () => void;
  canRemove: boolean;
}

const MODES: { value: TransportMode; icon: string; label: string }[] = [
  { value: 'transit', icon: '🚇', label: 'Transit' },
  { value: 'driving', icon: '🚗', label: 'Drive' },
  { value: 'walking', icon: '🚶', label: 'Walk' },
  { value: 'cycling', icon: '🚴', label: 'Bike' },
];

export default function PersonInput({
  person,
  onUpdate,
  onRemove,
  canRemove,
}: PersonInputProps) {
  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState<
    { placeId: string; description: string }[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleAddressChange = (value: string) => {
    setAddress(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geocode?q=${encodeURIComponent(value)}`
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions ?? []);
          setShowSuggestions(true);
        }
      } catch {
        // Geocode not implemented yet — manual lat/lng entry as fallback
      }
    }, 300);
  };

  const handleSelectSuggestion = async (suggestion: {
    placeId: string;
    description: string;
  }) => {
    setAddress(suggestion.description);
    setSuggestions([]);
    setShowSuggestions(false);

    // Fetch lat/lng from place ID
    try {
      const res = await fetch(
        `/api/geocode?placeId=${encodeURIComponent(suggestion.placeId)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.lat && data.lng) {
          onUpdate({ ...person, lat: data.lat, lng: data.lng });
        }
      }
    } catch {
      // Geocode not implemented yet
    }
  };

  const handleModeChange = (mode: TransportMode) => {
    onUpdate({ ...person, mode });
  };

  const handleLabelChange = (label: string) => {
    onUpdate({ ...person, label });
  };

  const hasLocation = person.lat !== 0 && person.lng !== 0;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center gap-2.5">
        {/* Color dot */}
        <div
          className="h-5 w-5 shrink-0 rounded-full shadow-sm"
          style={{ backgroundColor: person.color }}
        />

        {/* Name input */}
        <input
          value={person.label}
          onChange={(e) => handleLabelChange(e.target.value)}
          className="h-8 w-24 rounded-lg bg-transparent text-sm font-semibold focus:outline-none focus:bg-muted/50 px-1.5 transition-colors"
          placeholder="Name"
        />

        {/* Location badge */}
        {hasLocation && (
          <span className="ml-auto mr-1 flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            set
          </span>
        )}

        {/* Remove button */}
        {canRemove && (
          <button
            onClick={onRemove}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Address input with suggestions */}
      <div className="relative mt-2.5">
        <input
          value={address}
          onChange={(e) => handleAddressChange(e.target.value)}
          placeholder="Search address or click the map..."
          className="flex h-10 w-full rounded-xl border border-input bg-muted/30 px-3.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-border/60 bg-card shadow-xl shadow-black/8 overflow-hidden">
            {suggestions.map((s) => (
              <button
                key={s.placeId}
                className="w-full px-3.5 py-2.5 text-left text-sm hover:bg-primary/5 transition-colors first:rounded-t-xl last:rounded-b-xl"
                onClick={() => handleSelectSuggestion(s)}
              >
                {s.description}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Transport mode pills */}
      <div className="mt-2.5 flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => handleModeChange(m.value)}
            className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-xl text-xs font-medium transition-all ${
              person.mode === m.value
                ? 'bg-foreground text-background shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
            title={m.label}
          >
            <span className="text-sm">{m.icon}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
