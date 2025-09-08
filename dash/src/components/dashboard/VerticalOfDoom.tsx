"use client";

import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import type { ReactElement } from "react";
import clsx from "clsx";

import { useDataStore, useCarDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { DriverList, TimingDataDriver, Sector } from "@/types/state.type";

// Reuse parsing helpers from Circle (duplicated for simplicity & isolation)
function parseSeconds(input?: string): number | null {
  if (!input) return null;
  const s = input.trim();
  if (/[0-9]+L/i.test(s)) return null;
  if (!s.startsWith("+") && !s.startsWith("-")) return null;
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

// Parse a lap time like "1:20.901" or "59.873" to seconds (number)
function parseLapTimeToSeconds(input?: string): number | null {
  if (!input) return null;
  const s = input.trim();
  // mm:ss.mmm
  const m = s.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (m) {
    const mins = parseInt(m[1], 10);
    const secs = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
    return mins * 60 + secs + ms / 1000;
  }
  // ss.mmm
  const sOnly = s.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (sOnly) {
    const secs = parseInt(sOnly[1], 10);
    const ms = sOnly[2] ? parseInt(sOnly[2].padEnd(3, "0"), 10) : 0;
    return secs + ms / 1000;
  }
  return null;
}

// Format keeping only seconds with first decimal, truncated (not rounded)
function formatSecondsOneDecimalTrunc(totalSeconds: number): string {
  const secs = totalSeconds % 60; // drop minutes
  const truncated = Math.floor(secs * 10) / 10;
  // ensure single decimal place and leading 0 for < 1.0
  const str = truncated.toFixed(1);
  return str;
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

type Dot = {
  y: number;
  tla: string;
  color?: string;
  hidden: boolean;
  racingNumber: string;
  isFavorite: boolean;
  gap: number;
  overMax: boolean;
  drsOn: boolean;
};

type VODProps = {
  orientation?: "vertical" | "horizontal";
};

export default function VerticalOfDoom({ orientation = "vertical" }: VODProps) {
  const timing = useDataStore((s) => s.timingData);
  const drivers = useDataStore((s) => s.driverList) as DriverList | null;
  const appData = useDataStore((s) => s.timingAppData);
  const favoriteDrivers = useSettingsStore((s) => s.favoriteDrivers);
  const scaleType = useSettingsStore((s) => s.circleScale);
  const g1Setting = useSettingsStore((s) => s.circleG1);
  const g2Setting = useSettingsStore((s) => s.circleG2);
  const fixedSec = useSettingsStore((s) => s.circleFixedSeconds);
  const topN = useSettingsStore((s) => s.circleTopN);
  const showConnectors = useSettingsStore((s) => s.showVerticalConnectors);

  const ordered = useMemo(() => getDriverOrder(timing?.lines), [timing]);
  const gaps = useMemo(() => computeGapsSeconds(ordered, timing?.sessionPart), [ordered, timing?.sessionPart]);
  const carsData = useCarDataStore((s) => s.carsData);

  const visible = useMemo(() => {
    const n = topN && topN > 0 ? Math.min(topN, ordered.length) : ordered.length;
    return ordered.slice(0, n);
  }, [ordered, topN]);

  const G1 = Math.max(0.5, Math.min(g1Setting || 3, g2Setting || 15));
  const G2 = Math.max(G1 + 0.5, g2Setting || 15);

  const spreadSeconds = useMemo(() => {
    const values = visible.map((d) => gaps.get(d.racingNumber) ?? 0).filter((v) => Number.isFinite(v));
    return values.length ? Math.max(...values) : 0;
  }, [visible, gaps]);

  // map gap -> unit (0..1), piecewise uses 0..0.7 and 0.7..1 ratio
  const mapGapToUnit = useCallback(
    (gap: number): number => {
      if (!Number.isFinite(gap) || gap <= 0) return 0;
      if (scaleType === "piecewise") {
        if (gap <= G1) return (gap / G1) * 0.7;
        if (gap <= G2) return 0.7 + ((gap - G1) / (G2 - G1)) * 0.3;
        return 1;
      }
      const base = scaleType === "fixed" ? Math.max(1, fixedSec || 30) : Math.max(1, spreadSeconds || 1);
      return Math.min(1, gap / base);
    },
    [scaleType, G1, G2, fixedSec, spreadSeconds],
  );

  const piecewiseStretch = useMemo(() => {
    if (scaleType !== "piecewise") return 1;
    const maxGap = Math.max(...visible.map((d) => gaps.get(d.racingNumber) ?? 0), 0);
    const base = mapGapToUnit(maxGap);
    if (base <= 0 || base >= 1) return 1;
    return 1 / base;
  }, [scaleType, visible, gaps, mapGapToUnit]);

  const dots: Dot[] = useMemo(() => {
    return visible.map((d) => {
      const gap = gaps.get(d.racingNumber) ?? 0;
      const u = mapGapToUnit(gap) * (scaleType === "piecewise" ? piecewiseStretch : 1);
      const meta = drivers?.[d.racingNumber];
      const hidden = d.knockedOut || d.stopped || d.retired;
      const isFavorite = favoriteDrivers.includes(d.racingNumber);
      const baseSec = scaleType === "piecewise" ? G2 : scaleType === "fixed" ? Math.max(1, fixedSec || 30) : Math.max(1, spreadSeconds || 1);
      const drsVal = carsData?.[d.racingNumber]?.Channels?.[45];
      const drsOn = typeof drsVal === "number" ? drsVal > 9 : false;
      return {
        y: Math.min(1, u),
        tla: meta?.tla ?? d.racingNumber,
        color: meta?.teamColour ? `#${meta.teamColour}` : undefined,
        hidden,
        racingNumber: d.racingNumber,
        isFavorite,
        gap,
        overMax: gap > baseSec,
        drsOn,
      } as Dot;
    });
  }, [visible, gaps, mapGapToUnit, piecewiseStretch, drivers, favoriteDrivers, scaleType, G2, fixedSec, spreadSeconds, carsData]);

  // layout params
  const width = 320;
  const [height, setHeight] = useState<number>(520);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const update = () => {
      if (wrapperRef.current) setHeight(wrapperRef.current.clientHeight);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const padTop = 10; // reduced to stretch the line
  const padBottom = 28; // reduced to stretch the line
  const axisX = 40;
  const yOf = (unit: number) => padTop + unit * (height - padTop - padBottom);

  return (
    <div ref={wrapperRef} className="h-[85vh] 2xl:h-[90vh] rounded-lg border border-zinc-800 p-2">
      <h3 className="mb-2 text-sm font-medium text-zinc-400">Vertical of Doom - distacchi</h3>
      <div className="flex h-[calc(100%-1.75rem)] items-center justify-center">
        <svg
          width={orientation === "horizontal" ? height : width}
          height={orientation === "horizontal" ? width : height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <g transform={orientation === "horizontal" ? `translate(0, ${height}) rotate(-90)` : undefined}>
          {/* axis */}
          <line x1={axisX} y1={padTop} x2={axisX} y2={height - padBottom} className="stroke-zinc-800" strokeWidth={2} />

          {/* ticks */}
          {(() => {
            const elems: ReactElement[] = [];
            const pushTick = (sec: number, major: boolean) => {
              const u = mapGapToUnit(sec) * (scaleType === "piecewise" ? piecewiseStretch : 1);
              const y = yOf(Math.min(1, u));
              elems.push(
                <g key={`t-${sec}-${major ? "M" : "m"}`}>
                  <line x1={axisX - (major ? 8 : 5)} y1={y} x2={axisX + (major ? 8 : 5)} y2={y} className="stroke-zinc-700" strokeWidth={1} />
                  {major && (
                    <text x={axisX - 12} y={y + 4} textAnchor="end" className="fill-zinc-500" fontSize={11}>
                      {sec}s
                    </text>
                  )}
                </g>,
              );
            };

            if (scaleType === "piecewise") {
              for (let s = 0.5; s < G1 + 1e-6; s += 0.5) pushTick(s, false);
              for (let s = 1; s < G2 + 1e-6; s += 1) pushTick(s, true);
            } else {
              const base = scaleType === "fixed" ? Math.max(1, fixedSec || 30) : Math.max(1, spreadSeconds || 1);
              const limit = Math.min(30, Math.floor(base));
              const minor = base <= 12 ? 0.5 : 0;
              if (minor > 0) for (let s = minor; s < limit + 1e-6; s += minor) pushTick(s, false);
              for (let s = 1; s < limit + 1e-6; s += 1) pushTick(s, true);
            }
            return elems;
          })()}

          {/* leader marker */}
          <circle cx={axisX} cy={yOf(0)} r={3} className="fill-zinc-500" />

          {/* connectors between adjacent drivers (only when not too close) */}
          {showConnectors && (() => {
            const elems: ReactElement[] = [];
            const MIN_PIXELS = 18; // minimum height to render connector
            const x = axisX + 28;
            for (let i = 1; i < dots.length; i++) {
              const prev = dots[i - 1];
              const cur = dots[i];
              const y1 = yOf(prev.y);
              const y2 = yOf(cur.y);
              const top = Math.min(y1, y2);
              const bottom = Math.max(y1, y2);
              const h = bottom - top;
              if (h < MIN_PIXELS) continue; // too close -> skip

              const timingDriver = timing?.lines?.[cur.racingNumber];
              const catching = timingDriver?.intervalToPositionAhead?.catching;
              const valStr = timingDriver?.intervalToPositionAhead?.value;
              const strokeClass = catching === true ? "stroke-emerald-500" : catching === false ? "stroke-red-500" : "stroke-zinc-600";
              const fillClass = catching === true ? "fill-emerald-500" : catching === false ? "fill-red-500" : "fill-zinc-600";
              // Only show connector and gap if interval >= 1s
              const parsed = valStr ? parseSeconds(valStr) : null;
              const intervalSec = parsed != null ? Math.abs(parsed) : Math.max(0, cur.gap - prev.gap);
              if (!(Number.isFinite(intervalSec) && intervalSec >= 1)) continue;

              elems.push(
                <g key={`conn-${cur.racingNumber}`}>
                  <line x1={x} y1={top} x2={x} y2={bottom} className={strokeClass} strokeWidth={2} strokeLinecap="round" />
                  <text x={x + 8} y={(top + bottom) / 2 + 4} className={fillClass} fontSize={11}>
                    {(valStr && intervalSec >= 1) ? valStr : `${intervalSec.toFixed(3)}s`}
                  </text>
                </g>,
              );
            }
            return elems;
          })()}

          {/* dots */}
          {dots.map((d) => {
            const y = yOf(d.y);
            const stints = appData?.lines?.[d.racingNumber]?.stints;
            const stint = stints && stints.length > 0 ? stints[stints.length - 1] : undefined;
            const comp = (stint?.compound || "").toLowerCase();
            const known = ["soft", "medium", "hard", "intermediate", "wet"].includes(comp);
            const iconHref = known ? `/tires/${comp}.svg` : "/tires/unknown.svg";
            const last = timing?.lines?.[d.racingNumber]?.lastLapTime;
            const lastVal = last?.value;
            const compactLast = lastVal != null ? (() => {
              const s = parseLapTimeToSeconds(lastVal);
              return s != null ? formatSecondsOneDecimalTrunc(s) : null;
            })() : null;
            const lastFillClass = last?.overallFastest
              ? "fill-violet-600!"
              : last?.personalFastest
              ? "fill-emerald-500!"
              : lastVal
              ? "fill-zinc-600"
              : "fill-zinc-500!";
            const lastClass = clsx("tabular-nums", lastFillClass);

            // sectors semaforo (3 rettangoli): violet = overall best, green = personal best, yellow = no improvement, gray = no data
            const sectors: Sector[] = timing?.lines?.[d.racingNumber]?.sectors ?? [];
            const sectorFill = (s?: Sector) =>
              s?.overallFastest ? "fill-violet-600" : s?.personalFastest ? "fill-emerald-500" : s && s.value ? "fill-amber-400" : "fill-zinc-700";
            let lastUpdated = -1;
            for (let i = 0; i < Math.min(3, sectors.length); i++) {
              if (sectors[i]?.value) lastUpdated = i;
            }
            return (
              <g key={`vdot-${d.racingNumber}`} className={clsx({ "opacity-30": d.hidden })}>
                <circle cx={axisX + 40} cy={y} r={7} fill={d.color ?? "#DDD"} />
                {d.isFavorite && (
                  <circle cx={axisX + 40} cy={y} r={10} fill="transparent" className="stroke-sky-400" strokeWidth={2} />
                )}
                <text x={axisX + 60} y={y + 4} className="fill-zinc-300" fontSize={14} fontWeight="bold">
                  {d.tla}
                  {d.drsOn && (
                    <tspan dx={6} className="fill-emerald-500" fontSize={11}>
                      DRS
                    </tspan>
                  )}
                </text>
                {/* semaforo settori (3 rettangoli) */}
                {([0,1,2] as const).map((i) => {
                  const s = sectors[i];
                  const x = axisX + 110 + i * 12;
                  const strokeClass = lastUpdated === i ? "stroke-red-600" : "stroke-transparent";
                  return (
                    <rect
                      key={`sec-${d.racingNumber}-${i}`}
                      x={x}
                      y={y - 6}
                      width={10}
                      height={10}
                      rx={2}
                      className={clsx(sectorFill(s), strokeClass)}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {/* tire icon before time */}
                <image href={iconHref} x={axisX + 152} y={y - 8} width="16" height="16" />
                {/* last lap time, compact seconds with 1 decimal (truncated) */}
                <text x={axisX + 174} y={y + 4} className={lastClass} fontSize={12}>
                  {compactLast ?? "-- -- ---"}
                </text>
                {/* removed laps on stint label */}
                {d.overMax && (
                  <text x={axisX + 244} y={y + 4} className="fill-zinc-500" fontSize={11}>
                    +{(d.gap - (scaleType === "piecewise" ? G2 : scaleType === "fixed" ? Math.max(1, fixedSec || 30) : Math.max(1, spreadSeconds || 1))).toFixed(1)}s
                  </text>
                )}
              </g>
            );
          })}

          {/* legend */}
          <text x={width / 2} y={height - 12} textAnchor="middle" className="fill-zinc-500" fontSize={12}>
            {scaleType === "piecewise"
              ? `Scala: 0-${G1}s -> 70%, ${G1}-${G2}s -> +30%${piecewiseStretch !== 1 ? ` (stretch x${piecewiseStretch.toFixed(2)})` : ""}`
              : scaleType === "fixed"
              ? `Altezza = ${Math.max(1, fixedSec || 30)}s`
              : `Altezza = spread attuale (${Math.max(1, spreadSeconds || 1).toFixed(1)}s) (Top ${visible.length})`}
          </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
