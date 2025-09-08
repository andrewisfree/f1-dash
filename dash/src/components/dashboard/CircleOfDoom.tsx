"use client";

import { useMemo, useCallback } from "react";
import type { ReactElement } from "react";
import clsx from "clsx";

import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { DriverList, TimingDataDriver } from "@/types/state.type";
import { polarToCartesian } from "@/lib/circle";

type Dot = {
  angle: number;
  radius: number;
  tla: string;
  color?: string;
  hidden: boolean;
  racingNumber: string;
  isFavorite: boolean;
  gap: number;
  overMax: boolean;
};

function parseSeconds(input?: string): number | null {
  if (!input) return null;
  const s = input.trim();
  if (/[0-9]+L/i.test(s)) return null; // ignore +1L etc
  if (!s.startsWith("+") && !s.startsWith("-")) return null; // require sign for gaps
  const sign = s.startsWith("-") ? -1 : 1;
  const v = s.replace(/^[-+]/, "");

  const hms = v.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (hms) {
    const mins = parseInt(hms[1], 10);
    const secs = parseInt(hms[2], 10);
    const ms = hms[3] ? parseInt(hms[3].padEnd(3, "0"), 10) : 0;
    return sign * (mins * 60 + secs + ms / 1000);
  }

  const ss = v.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (ss) {
    const secs = parseInt(ss[1], 10);
    const ms = ss[2] ? parseInt(ss[2].padEnd(3, "0"), 10) : 0;
    return sign * (secs + ms / 1000);
  }
  return null;
}

function getDriverOrder(drivers: { [k: string]: TimingDataDriver } | undefined) {
  if (!drivers) return [] as TimingDataDriver[];
  return Object.values(drivers)
    .filter((d) => !!d.position)
    .sort((a, b) => parseInt(a.position) - parseInt(b.position));
}

function getGapToLeaderSeconds(d: TimingDataDriver, sessionPart?: number): number | null {
  const direct =
    parseSeconds(d.gapToLeader) ??
    parseSeconds(
      d.stats && sessionPart
        ? d.stats[Math.max(0, sessionPart - 1)]?.timeDiffToFastest
        : undefined,
    ) ??
    parseSeconds(d.timeDiffToFastest);
  return direct;
}

function getIntervalAheadSeconds(d: TimingDataDriver, sessionPart?: number): number | null {
  const interval =
    parseSeconds(d.intervalToPositionAhead?.value) ??
    parseSeconds(
      d.stats && sessionPart
        ? d.stats[Math.max(0, sessionPart - 1)]?.timeDifftoPositionAhead
        : undefined,
    ) ??
    parseSeconds(d.timeDiffToPositionAhead);
  return interval;
}

function computeGapsSeconds(ordered: TimingDataDriver[], sessionPart?: number): Map<string, number> {
  const gaps = new Map<string, number>();
  if (ordered.length === 0) return gaps;
  gaps.set(ordered[0].racingNumber, 0);
  for (let i = 1; i < ordered.length; i++) {
    const d = ordered[i];
    const direct = getGapToLeaderSeconds(d, sessionPart);
    if (direct != null) {
      gaps.set(d.racingNumber, Math.max(0, direct));
      continue;
    }
    const prev = ordered[i - 1];
    const prevGap = gaps.get(prev.racingNumber) ?? 0;
    const step = getIntervalAheadSeconds(d, sessionPart);
    gaps.set(d.racingNumber, Math.max(0, prevGap + (step ?? 0)));
  }
  return gaps;
}

function getLapSecondsForLeader(leader?: TimingDataDriver): number {
  const last = parseSeconds(leader?.lastLapTime?.value);
  if (last && last > 10) return last;
  const best = parseSeconds(leader?.bestLapTime?.value);
  if (best && best > 10) return best;
  return 90;
}

export default function CircleOfDoom() {
  const timing = useDataStore((s) => s.timingData);
  const drivers = useDataStore((s) => s.driverList) as DriverList | null;
  const favoriteDrivers = useSettingsStore((s) => s.favoriteDrivers);
  const scaleType = useSettingsStore((s) => s.circleScale);
  const g1Setting = useSettingsStore((s) => s.circleG1);
  const g2Setting = useSettingsStore((s) => s.circleG2);
  const fixedSec = useSettingsStore((s) => s.circleFixedSeconds);
  const topN = useSettingsStore((s) => s.circleTopN);

  const ordered = useMemo(() => getDriverOrder(timing?.lines), [timing]);
  const leader = ordered[0];
  const lapSeconds = getLapSecondsForLeader(leader);
  const gaps = useMemo(() => computeGapsSeconds(ordered, timing?.sessionPart), [ordered, timing?.sessionPart]);

  // select visible subset (Top N)
  const visible = useMemo(() => {
    const n = topN && topN > 0 ? Math.min(topN, ordered.length) : ordered.length;
    return ordered.slice(0, n);
  }, [ordered, topN]);

  // thresholds
  const G1 = Math.max(0.5, Math.min(g1Setting || 3, g2Setting || 15));
  const G2 = Math.max(G1 + 0.5, g2Setting || 15);

  // spread for 'spread' mode
  const spreadSeconds = useMemo(() => {
    const values = visible.map((d) => gaps.get(d.racingNumber) ?? 0).filter((v) => Number.isFinite(v));
    const max = values.length ? Math.max(...values) : 0;
    return max > 0 ? max : lapSeconds || 90;
  }, [visible, gaps, lapSeconds]);

  // piecewise stretch so visible set fills 360°
  const piecewiseStretch = useMemo(() => {
    if (scaleType !== "piecewise") return 1;
    const tG1 = Math.max(0.5, Math.min(g1Setting || 3, g2Setting || 15));
    const tG2 = Math.max(tG1 + 0.5, g2Setting || 15);
    const maxGap = Math.max(...visible.map((d) => gaps.get(d.racingNumber) ?? 0), 0);
    const baseAngle = (() => {
      if (!Number.isFinite(maxGap) || maxGap <= 0) return 0;
      if (maxGap <= tG1) return (maxGap / tG1) * 240;
      if (maxGap <= tG2) return 240 + ((maxGap - tG1) / (tG2 - tG1)) * 120;
      return 360;
    })();
    if (baseAngle <= 0 || baseAngle >= 360) return 1;
    return 360 / baseAngle;
  }, [scaleType, visible, gaps, g1Setting, g2Setting]);

  const mapGapToAngle = useCallback((gap: number): number => {
    if (!Number.isFinite(gap) || gap <= 0) return 0;
    if (scaleType === "piecewise") {
      if (gap <= G1) return (gap / G1) * 240;
      if (gap <= G2) return 240 + ((gap - G1) / (G2 - G1)) * 120;
      return 360;
    }
    const base = scaleType === "fixed" ? Math.max(1, fixedSec || 30) : spreadSeconds;
    return Math.min(360, (gap / base) * 360);
  }, [scaleType, G1, G2, fixedSec, spreadSeconds]);

  const dots: Dot[] = useMemo(() => {
    return visible.map((d) => {
      const gap = gaps.get(d.racingNumber) ?? 0;
      const raw = mapGapToAngle(gap);
      const angle = Math.min(359.9, scaleType === "piecewise" ? raw * piecewiseStretch : raw);
      const meta = drivers?.[d.racingNumber];
      const hidden = d.knockedOut || d.stopped || d.retired;
      const isFavorite = favoriteDrivers.includes(d.racingNumber);
      const base = scaleType === "piecewise" ? G2 : scaleType === "fixed" ? Math.max(1, fixedSec || 30) : spreadSeconds;
      return {
        angle,
        radius: 140,
        tla: meta?.tla ?? d.racingNumber,
        color: meta?.teamColour ? `#${meta.teamColour}` : undefined,
        hidden,
        racingNumber: d.racingNumber,
        isFavorite,
        gap,
        overMax: gap > base,
      } as Dot;
    });
  }, [visible, gaps, drivers, favoriteDrivers, mapGapToAngle, piecewiseStretch, scaleType, fixedSec, spreadSeconds, G2]);

  // SVG params
  const size = 520;
  const cx = size / 2;
  const cy = size / 2;
  const ringR = 200;

  return (
    <div className="h-[30rem] rounded-lg border border-zinc-800 p-2">
      <h3 className="mb-2 text-sm font-medium text-zinc-400">Circle of Doom - distacchi</h3>
      <div className="flex h-[calc(100%-1.75rem)] items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <defs>
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* outer rings */}
          <circle cx={cx} cy={cy} r={ringR + 18} className="stroke-zinc-900" strokeWidth={6} fill="transparent" />
          <circle cx={cx} cy={cy} r={ringR} className="stroke-zinc-800" strokeWidth={3} fill="transparent" />

          {/* ticks */}
          {(() => {
            const elems: ReactElement[] = [];
            const pushTick = (ang: number, major = false, key: string) => {
              const p1 = polarToCartesian(cx, cy, ringR - (major ? 10 : 6), ang);
              const p2 = polarToCartesian(cx, cy, ringR + (major ? 10 : 6), ang);
              elems.push(
                <line key={key} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="stroke-zinc-700" strokeWidth={major ? 1.5 : 1} />,
              );
            };
            if (scaleType === "piecewise") {
              for (let s = 0.5; s < G1 + 1e-6; s += 0.5) pushTick(Math.min(360, mapGapToAngle(s) * piecewiseStretch), false, `m-${s}`);
              for (let s = 1; s < G2 + 1e-6; s += 1) pushTick(Math.min(360, mapGapToAngle(s) * piecewiseStretch), true, `M-${s}`);
            } else {
              const base = scaleType === "fixed" ? Math.max(1, fixedSec || 30) : spreadSeconds;
              const limit = Math.min(30, Math.floor(base));
              const minor = base <= 12 ? 0.5 : 0;
              if (minor > 0) for (let s = minor; s < limit + 1e-6; s += minor) pushTick(mapGapToAngle(s), false, `m-${s}`);
              for (let s = 1; s < limit + 1e-6; s += 1) pushTick(mapGapToAngle(s), true, `M-${s}`);
            }
            return elems;
          })()}

          {/* finish marker at 0deg (top) */}
          {(() => {
            const p = polarToCartesian(cx, cy, ringR + 14, 0);
            return <circle cx={p.x} cy={p.y} r={4} className="fill-zinc-500" />;
          })()}

          {/* driver dots */}
          {dots.map((d) => {
            const p = polarToCartesian(cx, cy, d.radius, d.angle);
            return (
              <g key={`dot-${d.racingNumber}`} className={clsx({ "opacity-30": d.hidden })} filter="url(#shadow)">
                <circle cx={p.x} cy={p.y} r={7} fill={d.color ?? "#DDD"} />
                {d.isFavorite && <circle cx={p.x} cy={p.y} r={10} fill="transparent" className="stroke-sky-400" strokeWidth={2} />}
                <text x={p.x + 12} y={p.y + 4} className="fill-zinc-300" fontSize={14} fontWeight="bold">
                  {d.tla}
                </text>
                {d.overMax && (() => {
                  const po = polarToCartesian(cx, cy, ringR + 24, d.angle);
                  const base = scaleType === "piecewise" ? G2 : scaleType === "fixed" ? Math.max(1, fixedSec || 30) : spreadSeconds;
                  return (
                    <text x={po.x} y={po.y} textAnchor="middle" className="fill-zinc-500" fontSize={11}>
                      +{(d.gap - base).toFixed(1)}s
                    </text>
                  );
                })()}
              </g>
            );
          })}

          {/* center label (leader TLA) */}
          {leader && (
            <g>
              <rect x={cx - 46} y={cy - 24} width={92} height={48} rx={12} className="fill-blue-700/70" />
              <text x={cx} y={cy + 6} textAnchor="middle" className="fill-white" fontSize={28} fontWeight="bold">
                {(drivers?.[leader.racingNumber]?.tla ?? leader.racingNumber).toUpperCase()}
              </text>
            </g>
          )}

          {/* legend */}
          <text x={cx} y={cy + ringR + 36} textAnchor="middle" className="fill-zinc-500" fontSize={12}>
            {scaleType === "piecewise"
              ? `Scala: 0-${G1}s -> 240deg, ${G1}-${G2}s -> +120deg${piecewiseStretch !== 1 ? ` (stretch x${piecewiseStretch.toFixed(2)})` : ""}`
              : scaleType === "fixed"
              ? `360deg = ${Math.max(1, fixedSec || 30)}s`
              : `360deg = spread attuale (${spreadSeconds.toFixed(1)}s) (Top ${visible.length})`}
          </text>
        </svg>
      </div>
    </div>
  );
}
