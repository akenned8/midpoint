// Fairness ↔ Efficiency slider
'use client';

import { Slider } from '@/components/ui/slider';

interface ObjectiveSliderProps {
  alpha: number; // 0 = efficiency, 1 = fairness
  onChange: (alpha: number) => void;
}

export default function ObjectiveSlider({ alpha, onChange }: ObjectiveSliderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Fastest overall</span>
        <span className="font-medium">
          {alpha >= 0.8 ? 'Fairest' : alpha >= 0.4 ? 'Balanced' : 'Fastest'}
        </span>
        <span className="text-muted-foreground">Fairest for all</span>
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
    </div>
  );
}
