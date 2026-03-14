// Address autocomplete + transport mode selector per person
'use client';

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        {/* Color indicator */}
        <div
          className="h-4 w-4 shrink-0 rounded-full"
          style={{ backgroundColor: person.color }}
        />

        {/* Name input */}
        <Input
          value={person.label}
          onChange={(e) => handleLabelChange(e.target.value)}
          className="h-8 w-24 text-sm font-medium"
          placeholder="Name"
        />

        {/* Remove button */}
        {canRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="ml-auto h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            ×
          </Button>
        )}
      </div>

      {/* Address input with suggestions */}
      <div className="relative">
        <Input
          value={address}
          onChange={(e) => handleAddressChange(e.target.value)}
          placeholder="Enter address or neighborhood..."
          className="h-9 text-sm"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
            {suggestions.map((s) => (
              <button
                key={s.placeId}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => handleSelectSuggestion(s)}
              >
                {s.description}
              </button>
            ))}
          </div>
        )}

        {/* Manual lat/lng display if set */}
        {person.lat !== 0 && person.lng !== 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {person.lat.toFixed(4)}, {person.lng.toFixed(4)}
          </p>
        )}
      </div>

      {/* Transport mode selector */}
      <div className="flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => handleModeChange(m.value)}
            className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-md text-xs transition-colors ${
              person.mode === m.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
            title={m.label}
          >
            <span>{m.icon}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Staten Island warning */}
      {person.mode === 'transit' && person.lat > 0 && person.lat < 40.65 && person.lng < -74.05 && (
        <p className="text-xs text-amber-600">
          Staten Island ferry schedule may affect travel time accuracy
        </p>
      )}
    </div>
  );
}
