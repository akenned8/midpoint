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
    <div className="relative rounded-md border border-[var(--rule)] bg-[var(--card)] overflow-hidden">
      {/* Color stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: person.color }} />

      <div className="pl-3 pr-2.5 py-2.5">
        {/* Top row: name + status */}
        <div className="flex items-center gap-2">
          <input
            value={person.label}
            onChange={(e) => onUpdate({ ...person, label: e.target.value })}
            className="h-7 flex-1 min-w-0 bg-transparent text-[14px] font-semibold text-[var(--ink)] focus:outline-none placeholder:text-[var(--ink-muted)]"
            placeholder="Name"
          />
          {hasLocation ? (
            <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--good)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" />
              SET
            </span>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              EMPTY
            </span>
          )}
          {hasLocation && (
            <button
              type="button"
              onClick={() => onUpdate({ ...person, lat: 0, lng: 0 })}
              className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--hot)] transition-colors"
            >
              Reset
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex h-5 w-5 items-center justify-center text-[var(--ink-muted)] hover:text-[var(--hot)] transition-colors"
              aria-label="Remove person"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
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
            placeholder="Search address or tap the map…"
            className="h-[40px] w-full rounded-sm border border-[var(--rule)] bg-[var(--paper)] px-3 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)] focus:bg-[var(--paper-deep)]/40 transition-colors"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-30 mt-1 w-full rounded-sm border border-[var(--ink)] bg-[var(--card)] shadow-[0_8px_24px_rgba(20,23,31,0.16)] overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s.placeId}
                  type="button"
                  className={`w-full px-3 py-2.5 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-colors ${
                    i > 0 ? 'border-t border-[var(--rule)]' : ''
                  }`}
                  onClick={() => handleSelectSuggestion(s)}
                >
                  {s.description}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transport mode — editorial segmented */}
        <div className="mt-2 grid grid-cols-4 border border-[var(--rule)] rounded-sm overflow-hidden">
          {MODES.map((m, i) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onUpdate({ ...person, mode: m.value })}
              className={`flex h-[34px] items-center justify-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.08em] transition-colors ${
                i > 0 ? 'border-l border-[var(--rule)]' : ''
              } ${
                person.mode === m.value
                  ? 'bg-[var(--ink)] text-[var(--paper)]'
                  : 'bg-[var(--card)] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]/50'
              }`}
            >
              <span className="leading-none">{MODE_ICONS[m.value]}</span>
              <span className="hidden xs:inline">{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
