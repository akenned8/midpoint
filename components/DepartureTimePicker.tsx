// When is the meetup? Quick presets + custom date/time
'use client';

import { useState } from 'react';

interface DepartureTimePickerProps {
  value: string;
  onChange: (value: string) => void;
}

function getPresets(): { label: string; value: string }[] {
  const now = new Date();
  const today = new Date(now);

  const tonight = new Date(today);
  tonight.setHours(19, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);

  const saturday = new Date(today);
  const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
  saturday.setDate(saturday.getDate() + daysUntilSat);
  saturday.setHours(14, 0, 0, 0);

  const presets: { label: string; value: string }[] = [
    { label: 'Now', value: 'now' },
  ];

  if (now.getHours() < 19) {
    presets.push({ label: 'Tonight', value: tonight.toISOString() });
  }

  presets.push({ label: 'Tomorrow', value: tomorrow.toISOString() });

  if (daysUntilSat > 0 || now.getHours() < 14) {
    presets.push({ label: 'Saturday', value: saturday.toISOString() });
  }

  return presets;
}

export default function DepartureTimePicker({ value, onChange }: DepartureTimePickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const presets = getPresets();
  const isPreset = presets.some((p) => p.value === value) || value === 'now';

  const toLocalInput = (iso: string): string => {
    if (iso === 'now') return '';
    const d = new Date(iso);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  };

  const allOptions = [...presets, { label: 'Custom', value: '__custom__' }];

  return (
    <div className="space-y-2.5">
      <div className="eyebrow">02 / When</div>
      <div className={`grid border border-[var(--rule)] rounded-sm overflow-hidden`} style={{ gridTemplateColumns: `repeat(${allOptions.length}, 1fr)` }}>
        {allOptions.map((p, i) => {
          const isCustom = p.value === '__custom__';
          const isActive = isCustom ? (!isPreset || showCustom) : (value === p.value && !showCustom);
          return (
            <button
              key={p.value}
              type="button"
              className={`h-[34px] text-[11px] font-mono uppercase tracking-[0.08em] transition-colors ${
                i > 0 ? 'border-l border-[var(--rule)]' : ''
              } ${
                isActive
                  ? 'bg-[var(--ink)] text-[var(--paper)]'
                  : 'bg-[var(--card)] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]/50'
              }`}
              onClick={() => {
                if (isCustom) setShowCustom(true);
                else { onChange(p.value); setShowCustom(false); }
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {showCustom && (
        <input
          type="datetime-local"
          className="h-[40px] w-full rounded-sm border border-[var(--rule)] bg-[var(--paper)] px-3 text-[13px] text-[var(--ink)] focus:outline-none focus:border-[var(--ink)] transition-colors"
          value={toLocalInput(value)}
          onChange={(e) => { if (e.target.value) onChange(new Date(e.target.value).toISOString()); }}
          step={900}
        />
      )}
    </div>
  );
}
