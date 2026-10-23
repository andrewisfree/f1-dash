"use client";

import type { ReactNode } from "react";

import { useSettingsStore } from "@/stores/useSettingsStore";

import Input from "@/components/ui/Input";
import SegmentedControls from "@/components/ui/SegmentedControls";
import Toggle from "@/components/ui/Toggle";

// numbers typed in the boxes, anything else is ignored
const numeric = (set: (value: number) => void) => (input: string) => {
	const value = Number(input);
	if (!isNaN(value)) set(value);
};

function Option({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="flex items-center gap-2 text-xs text-zinc-400">
			{children}
			{label}
		</label>
	);
}

/**
 * how the tower is drawn, kept on the page so it can be changed during the race
 */
export default function VerticalOptions() {
	const settings = useSettingsStore();

	return (
		<div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
			<SegmentedControls
				id="vertical-scale"
				selected={settings.verticalScale}
				onSelect={settings.setVerticalScale}
				options={[
					{ label: "Battles", value: "battle" },
					{ label: "Spread", value: "spread" },
					{ label: "Fixed", value: "fixed" },
				]}
			/>

			{settings.verticalScale === "battle" && (
				<Option label="s expanded for close battles">
					<Input value={String(settings.verticalBattleSeconds)} setValue={numeric(settings.setVerticalBattleSeconds)} />
				</Option>
			)}

			{settings.verticalScale === "fixed" && (
				<Option label="s for the full height">
					<Input value={String(settings.verticalFixedSeconds)} setValue={numeric(settings.setVerticalFixedSeconds)} />
				</Option>
			)}

			<Option label="drivers shown (0 = all)">
				<Input value={String(settings.verticalTopN)} setValue={numeric(settings.setVerticalTopN)} />
			</Option>

			<Option label="s lost in a pit stop (also driver page and pit wall)">
				<Input value={String(settings.verticalPitLoss)} setValue={numeric(settings.setVerticalPitLoss)} />
			</Option>

			<div className="flex items-center gap-2 text-xs text-zinc-400">
				<Toggle enabled={settings.verticalConnectors} setEnabled={(v) => settings.setVerticalConnectors(v)} />
				Interval connectors
			</div>
		</div>
	);
}
