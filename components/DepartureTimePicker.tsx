// When is the meetup? Quick presets + custom date/time
'use client';

import { useState } from 'react';

interface DepartureTimePickerProps {
  value: string; // ISO8601 or 'now'
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

  // Next Saturday
  const saturday = new Date(today);
  const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
  saturday.setDate(saturday.getDate() + daysUntilSat);
  saturday.setHours(14, 0, 0, 0);

  const presets: { label: string; value: string }[] = [
    { label: 'Now', value: 'now' },
  ];

  // Only show "Tonight" if it's before 7pm
  if (now.getHours() < 19) {
    presets.push({ label: 'Tonight 7pm', value: tonight.toISOString() });
  }

  presets.push({ label: 'Tomorrow eve', value: tomorrow.toISOString() });

  // Only show Saturday if it's not already Saturday evening
  if (daysUntilSat > 0 || now.getHours() < 14) {
    presets.push({ label: 'Sat afternoon', value: saturday.toISOString() });
  }

  return presets;
}

export default function DepartureTimePicker({
  value,
  onChange,
}: DepartureTimePickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const presets = getPresets();

  const isPreset = presets.some((p) => p.value === value) || value === 'now';

  // Convert ISO to local datetime-local input value
  const toLocalInput = (iso: string): string => {
    if (iso === 'now') return '';
    const d = new Date(iso);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  };

  return (
    <div className="space-y-2.5">
      <label className="text-sm font-medium">When?</label>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.value}
            className={`h-8 rounded-xl px-3.5 text-xs font-medium transition-all ${
              value === p.value
                ? 'bg-foreground text-background shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
            onClick={() => {
              onChange(p.value);
              setShowCustom(false);
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          className={`h-8 rounded-xl px-3.5 text-xs font-medium transition-all ${
            !isPreset || showCustom
              ? 'bg-foreground text-background shadow-sm'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
          onClick={() => setShowCustom(true)}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <input
          type="datetime-local"
          className="h-10 w-auto rounded-xl border border-input bg-muted/30 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          value={toLocalInput(value)}
          onChange={(e) => {
            if (e.target.value) {
              onChange(new Date(e.target.value).toISOString());
            }
          }}
          step={900}
        />
      )}
    </div>
  );
}
