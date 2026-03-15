// Fairness ↔ Efficiency slider
'use client';

import { Slider } from '@/components/ui/slider';

interface ObjectiveSliderProps {
  alpha: number;
  onChange: (alpha: number) => void;
}

export default function ObjectiveSlider({ alpha, onChange }: ObjectiveSliderProps) {
  const label = alpha >= 0.8 ? 'Fairest' : alpha >= 0.4 ? 'Balanced' : 'Fastest';
  const labelColor = alpha >= 0.8 ? 'text-[#5856D6]' : alpha >= 0.4 ? 'text-[#FF9500]' : 'text-[#34C759]';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[#1D1D1F]">Priority</span>
        <span className={`text-[13px] font-semibold ${labelColor}`}>{label}</span>
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
      <div className="flex justify-between text-[11px] text-[#86868B]">
        <span>Fastest overall</span>
        <span>Fairest for all</span>
      </div>
    </div>
  );
}
