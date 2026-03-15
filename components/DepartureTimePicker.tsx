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

  return (
    <div className="space-y-2.5">
      <span className="text-[13px] font-medium text-[#1D1D1F]">When</span>
      <div className="flex rounded-lg bg-[#F5F5F7] p-[2px]">
        {presets.map((p) => (
          <button
            key={p.value}
            className={`flex-1 h-[30px] rounded-md text-[12px] font-medium transition-all ${
              value === p.value && !showCustom
                ? 'bg-white text-[#1D1D1F] shadow-sm shadow-black/8'
                : 'text-[#86868B] hover:text-[#1D1D1F]'
            }`}
            onClick={() => { onChange(p.value); setShowCustom(false); }}
          >
            {p.label}
          </button>
        ))}
        <button
          className={`flex-1 h-[30px] rounded-md text-[12px] font-medium transition-all ${
            (!isPreset || showCustom)
              ? 'bg-white text-[#1D1D1F] shadow-sm shadow-black/8'
              : 'text-[#86868B] hover:text-[#1D1D1F]'
          }`}
          onClick={() => setShowCustom(true)}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <input
          type="datetime-local"
          className="h-[36px] w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[13px] text-[#1D1D1F] focus:outline-none focus:ring-[3px] focus:ring-[#007AFF]/15 focus:border-[#007AFF]/40 transition-all"
          value={toLocalInput(value)}
          onChange={(e) => { if (e.target.value) onChange(new Date(e.target.value).toISOString()); }}
          step={900}
        />
      )}
    </div>
  );
}
