import type { HrZones } from '../lib/analysis/types';
import { fmtDuration } from '../lib/format';

const COLORS = ['bg-z1', 'bg-z2', 'bg-z3', 'bg-z4', 'bg-z5'];

export default function ZoneBars({ zones }: { zones: HrZones }) {
  const total = zones.timeInZoneS.reduce((a, b) => a + b, 0) + zones.belowZ1S;
  const max = Math.max(...zones.timeInZoneS, 1);
  const lower = [zones.lowerBound, ...zones.upperBounds.slice(0, 4)];
  return (
    <div className="space-y-2">
      {[4, 3, 2, 1, 0].map((i) => {
        const t = zones.timeInZoneS[i];
        const pct = total ? Math.round((t / total) * 100) : 0;
        return (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-7 font-semibold">Z{i + 1}</span>
            <span className="muted w-16 text-xs">{lower[i]}–{zones.upperBounds[i]}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
              <div className={`h-full rounded-md ${COLORS[i]}`} style={{ width: `${(t / max) * 100}%` }} />
            </div>
            <span className="w-12 text-right">{fmtDuration(t)}</span>
            <span className="muted w-9 text-right text-xs">{pct} %</span>
          </div>
        );
      })}
      <p className="muted pt-1 text-xs">
        {zones.source === 'fit' ? 'Zones de la montre' : 'Zones des réglages'} · FC max {zones.maxHr} bpm
        {zones.belowZ1S > 0 && ` · ${fmtDuration(zones.belowZ1S)} sous Z1`}
      </p>
    </div>
  );
}
