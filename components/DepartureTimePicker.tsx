// When is the meetup? Quick presets + custom date/time
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <div className="space-y-2">
      <label className="text-sm font-medium">When are you meeting?</label>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Button
            key={p.value}
            variant={value === p.value ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              onChange(p.value);
              setShowCustom(false);
            }}
          >
            {p.label}
          </Button>
        ))}
        <Button
          variant={!isPreset || showCustom ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowCustom(true)}
        >
          Custom
        </Button>
      </div>

      {showCustom && (
        <Input
          type="datetime-local"
          className="h-9 w-auto text-sm"
          value={toLocalInput(value)}
          onChange={(e) => {
            if (e.target.value) {
              onChange(new Date(e.target.value).toISOString());
            }
          }}
          // 15-minute increments
          step={900}
        />
      )}
    </div>
  );
}
