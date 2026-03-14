// Fairness ↔ Efficiency slider
'use client';

import { Slider } from '@/components/ui/slider';

interface ObjectiveSliderProps {
  alpha: number; // 0 = efficiency, 1 = fairness
  onChange: (alpha: number) => void;
}

export default function ObjectiveSlider({ alpha, onChange }: ObjectiveSliderProps) {
  const label = alpha >= 0.8 ? 'Fairest' : alpha >= 0.4 ? 'Balanced' : 'Fastest';

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Priority</label>
        <span className={`rounded-lg px-2.5 py-0.5 text-xs font-semibold ${
          alpha >= 0.8
            ? 'bg-violet-50 text-violet-700'
            : alpha >= 0.4
            ? 'bg-amber-50 text-amber-700'
            : 'bg-emerald-50 text-emerald-700'
        }`}>
          {label}
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
        className="w-full"
      />
      <div className="flex justify-between text-[11px] text-muted-foreground/70">
        <span>Fastest overall</span>
        <span>Fairest for all</span>
      </div>
    </div>
  );
}
