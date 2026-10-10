"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

export type LapChartSeries = {
	key: string;
	label: string;
	color: string;
	points: { lap: number; value: number }[];
};

type Props = {
	series: LapChartSeries[];
	format: (value: number) => string;
	emptyText: string;
	height?: number;
};

// chart surface, used for the ring around markers
const SURFACE = "#09090b";
const MARGIN = { top: 10, right: 58, bottom: 22, left: 46 };
const MIN_LABEL_GAP = 12;

function niceTicks(min: number, max: number, count: number): number[] {
	const span = max - min;
	if (span <= 0) return [min];

	const rough = span / count;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;

	const ticks: number[] = [];
	for (let tick = Math.ceil(min / step) * step; tick <= max + step / 1000; tick += step) {
		ticks.push(Math.round(tick / step) * step);
	}

	return ticks;
}

export default function LapChart({ series, format, emptyText, height = 220 }: Props) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState<number>(0);
	const [hoverLap, setHoverLap] = useState<number | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	const chart = useMemo(() => {
		const all = series.flatMap((line) => line.points);
		if (all.length < 2 || width <= 0) return null;

		const laps = all.map((point) => point.lap);
		const values = all.map((point) => point.value);
		const lapMin = Math.min(...laps);
		const lapMax = Math.max(lapMin + 1, ...laps);
		const rawMin = Math.min(...values);
		const rawMax = Math.max(...values);
		const padding = Math.max((rawMax - rawMin) * 0.1, 0.05);
		const valueMin = rawMin - padding;
		const valueMax = rawMax + padding;

		const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
		const plotHeight = height - MARGIN.top - MARGIN.bottom;
		const x = (lap: number) => MARGIN.left + ((lap - lapMin) / (lapMax - lapMin)) * plotWidth;
		const y = (value: number) => MARGIN.top + (1 - (value - valueMin) / (valueMax - valueMin)) * plotHeight;

		const lines = series
			.filter((line) => line.points.length > 0)
			.map((line) => {
				// a missing lap breaks the line instead of bridging it
				const path = line.points
					.map((point, index) => {
						const connected = index > 0 && point.lap - line.points[index - 1].lap === 1;
						return `${connected ? "L" : "M"}${x(point.lap).toFixed(1)},${y(point.value).toFixed(1)}`;
					})
					.join(" ");

				const last = line.points[line.points.length - 1];
				return { ...line, path, last, labelY: y(last.value) };
			});

		// keep the end labels apart
		const byLabel = [...lines].sort((a, b) => a.labelY - b.labelY);
		for (let i = 1; i < byLabel.length; i++) {
			byLabel[i].labelY = Math.max(byLabel[i].labelY, byLabel[i - 1].labelY + MIN_LABEL_GAP);
		}

		const lapStep = Math.max(1, Math.ceil((lapMax - lapMin) / Math.max(2, Math.floor(plotWidth / 48))));
		const lapTicks: number[] = [];
		for (let lap = lapMin; lap <= lapMax; lap += lapStep) lapTicks.push(lap);

		return {
			x,
			y,
			lines,
			lapMin,
			lapMax,
			plotWidth,
			plotHeight,
			lapTicks,
			valueTicks: niceTicks(valueMin, valueMax, 4),
		};
	}, [height, series, width]);

	const onPointer = (event: PointerEvent<SVGRectElement>) => {
		if (!chart) return;

		const bounds = event.currentTarget.getBoundingClientRect();
		const ratio = (event.clientX - bounds.left) / bounds.width;
		setHoverLap(Math.round(chart.lapMin + ratio * (chart.lapMax - chart.lapMin)));
	};

	const hovered =
		chart && hoverLap !== null
			? chart.lines
					.map((line) => ({ line, point: line.points.find((point) => point.lap === hoverLap) }))
					.filter((entry) => entry.point !== undefined)
			: [];

	return (
		<div>
			{series.length > 1 && (
				<div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
					{series.map((line) => (
						<span key={`legend.${line.key}`} className="flex items-center gap-1.5">
							<span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: line.color }} />
							{line.label}
						</span>
					))}
				</div>
			)}

			<div ref={containerRef} className="relative" style={{ height }}>
				{!chart && <div className="grid h-full place-items-center text-center text-sm text-zinc-600">{emptyText}</div>}

				{chart && (
					<svg width={width} height={height} className="block">
						{chart.valueTicks.map((tick) => (
							<g key={`value.${tick}`}>
								<line
									x1={MARGIN.left}
									x2={MARGIN.left + chart.plotWidth}
									y1={chart.y(tick)}
									y2={chart.y(tick)}
									stroke="#27272a"
									strokeWidth={1}
								/>
								<text
									x={MARGIN.left - 6}
									y={chart.y(tick)}
									textAnchor="end"
									dominantBaseline="middle"
									className="fill-zinc-500 text-[10px] tabular-nums"
								>
									{format(tick)}
								</text>
							</g>
						))}

						{chart.lapTicks.map((lap) => (
							<text
								key={`lap.${lap}`}
								x={chart.x(lap)}
								y={height - 6}
								textAnchor="middle"
								className="fill-zinc-500 text-[10px] tabular-nums"
							>
								L{lap}
							</text>
						))}

						{hoverLap !== null && hovered.length > 0 && (
							<line
								x1={chart.x(hoverLap)}
								x2={chart.x(hoverLap)}
								y1={MARGIN.top}
								y2={MARGIN.top + chart.plotHeight}
								stroke="#52525b"
								strokeWidth={1}
							/>
						)}

						{chart.lines.map((line) => (
							<g key={`line.${line.key}`}>
								<path
									d={line.path}
									fill="none"
									stroke={line.color}
									strokeWidth={2}
									strokeLinejoin="round"
									strokeLinecap="round"
								/>
								<circle
									cx={chart.x(line.last.lap)}
									cy={chart.y(line.last.value)}
									r={4}
									fill={line.color}
									stroke={SURFACE}
									strokeWidth={2}
								/>
								<text
									x={chart.x(line.last.lap) + 8}
									y={line.labelY}
									dominantBaseline="middle"
									className="fill-zinc-300 text-[10px] tabular-nums"
								>
									{format(line.last.value)}
								</text>
							</g>
						))}

						{hovered.map(({ line, point }) => (
							<circle
								key={`hover.${line.key}`}
								cx={chart.x(point!.lap)}
								cy={chart.y(point!.value)}
								r={4}
								fill={line.color}
								stroke={SURFACE}
								strokeWidth={2}
							/>
						))}

						<rect
							x={MARGIN.left}
							y={MARGIN.top}
							width={chart.plotWidth}
							height={chart.plotHeight}
							fill="transparent"
							style={{ touchAction: "pan-y" }}
							onPointerMove={onPointer}
							onPointerDown={onPointer}
							onPointerLeave={() => setHoverLap(null)}
						/>
					</svg>
				)}

				{chart && hoverLap !== null && hovered.length > 0 && (
					<div
						className="pointer-events-none absolute top-1 z-10 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs shadow-lg"
						style={
							chart.x(hoverLap) > width / 2 ? { right: width - chart.x(hoverLap) + 8 } : { left: chart.x(hoverLap) + 8 }
						}
					>
						<p className="text-zinc-500">Lap {hoverLap}</p>
						{hovered.map(({ line, point }) => (
							<p key={`tooltip.${line.key}`} className="flex items-center gap-1.5 whitespace-nowrap">
								<span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: line.color }} />
								<span className="font-semibold text-zinc-100 tabular-nums">{format(point!.value)}</span>
								<span className="text-zinc-500">{line.label}</span>
							</p>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
