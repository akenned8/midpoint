// Address autocomplete + transport mode selector per person
'use client';

import { useState, useRef, useEffect } from 'react';
import type { Person, TransportMode } from '@/types';

interface PersonInputProps {
  person: Person;
  onUpdate: (person: Person) => void;
  onRemove: () => void;
  canRemove: boolean;
}

const MODE_ICONS: Record<TransportMode, React.ReactNode> = {
  transit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="14" rx="2" /><path d="M4 11h16" /><path d="M12 3v8" /><circle cx="8" cy="21" r="1" /><circle cx="16" cy="21" r="1" /><path d="M8 17v4" /><path d="M16 17v4" />
    </svg>
  ),
  driving: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17h14v-5l-2-6H7L5 12v5z" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" />
    </svg>
  ),
  walking: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13" cy="4" r="2" /><path d="M10 22l2-7" /><path d="M16 22l-2-7-3-3 1-4 4 2 1 4" /><path d="M9 8l-4 4" />
    </svg>
  ),
  cycling: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17l3-7h4l3 7" /><path d="M12 5l1 5" /><circle cx="12" cy="4" r="1" />
    </svg>
  ),
};

const MODES: { value: TransportMode; label: string }[] = [
  { value: 'transit', label: 'Transit' },
  { value: 'driving', label: 'Drive' },
  { value: 'walking', label: 'Walk' },
  { value: 'cycling', label: 'Bike' },
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
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions ?? []);
          setShowSuggestions(true);
        }
      } catch {}
    }, 300);
  };

  const handleSelectSuggestion = async (suggestion: { placeId: string; description: string }) => {
    setAddress(suggestion.description);
    setSuggestions([]);
    setShowSuggestions(false);
    try {
      const res = await fetch(`/api/geocode?placeId=${encodeURIComponent(suggestion.placeId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.lat && data.lng) onUpdate({ ...person, lat: data.lat, lng: data.lng });
      }
    } catch {}
  };

  // Clear address when location is reset
  useEffect(() => {
    if (person.lat === 0 && person.lng === 0) {
      setAddress('');
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [person.lat, person.lng]);

  const hasLocation = person.lat !== 0 && person.lng !== 0;

  return (
    <div className="rounded-xl bg-[#F5F5F7] p-3">
      {/* Top row: color, name, location badge, remove */}
      <div className="flex items-center gap-2">
        <div
          className="h-[10px] w-[10px] shrink-0 rounded-full"
          style={{ backgroundColor: person.color }}
        />
        <input
          value={person.label}
          onChange={(e) => onUpdate({ ...person, label: e.target.value })}
          className="h-7 w-20 bg-transparent text-[13px] font-semibold text-[#1D1D1F] focus:outline-none"
          placeholder="Name"
        />
        {hasLocation && (
          <button
            onClick={() => onUpdate({ ...person, lat: 0, lng: 0 })}
            className="ml-auto text-[11px] font-medium text-[#FF3B30] hover:text-[#D70015] transition-colors"
          >
            Reset
          </button>
        )}
        {canRemove && (
          <button
            onClick={onRemove}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-black/5 text-[#86868B] hover:bg-black/10 hover:text-[#FF3B30] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Address input */}
      <div className="relative mt-2">
        <input
          value={address}
          onChange={(e) => handleAddressChange(e.target.value)}
          placeholder="Search address or tap map..."
          className="h-[36px] w-full rounded-lg border border-black/[0.06] bg-white px-3 text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[#007AFF]/15 focus:border-[#007AFF]/40 transition-all"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-black/[0.06] bg-white shadow-lg shadow-black/8 overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={s.placeId}
                className={`w-full px-3 py-2 text-left text-[13px] text-[#1D1D1F] hover:bg-[#F5F5F7] transition-colors ${
                  i > 0 ? 'border-t border-black/[0.04]' : ''
                }`}
                onClick={() => handleSelectSuggestion(s)}
              >
                {s.description}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Transport mode segmented control */}
      <div className="mt-2 flex rounded-lg bg-black/[0.04] p-[2px]">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => onUpdate({ ...person, mode: m.value })}
            className={`flex h-[28px] flex-1 items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-all ${
              person.mode === m.value
                ? 'bg-white text-[#1D1D1F] shadow-sm shadow-black/8'
                : 'text-[#86868B] hover:text-[#1D1D1F]'
            }`}
          >
            <span className="flex items-center justify-center text-[13px] leading-none">{MODE_ICONS[m.value]}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
