// Fairness ↔ Efficiency slider
'use client';

import { Slider } from '@/components/ui/slider';

interface ObjectiveSliderProps {
  alpha: number;
  onChange: (alpha: number) => void;
}

export default function ObjectiveSlider({ alpha, onChange }: ObjectiveSliderProps) {
  const label = alpha >= 0.8 ? 'Fairest' : alpha >= 0.4 ? 'Balanced' : 'Fastest';

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">03 / Priority</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[20px] text-[var(--ink)]" style={{ fontVariationSettings: '"opsz" 144' }}>
          {label}
        </span>
        <span className="font-mono text-[11px] tnum text-[var(--ink-muted)]">
          α = {alpha.toFixed(2)}
        </span>
      </div>
      <Slider
        value={[alpha * 100]}
        onValueChange={(val) => {
          const v = Array.isArray(val) ? val[0] : val;
          onChange(v / 100);
        }}
        min={0}
        max={100}
        step={5}
        className="w-full py-1"
      />
      <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
        <span>Fastest overall</span>
        <span>Fairest for all</span>
      </div>
    </div>
  );
}
