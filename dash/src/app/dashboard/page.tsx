"use client";

import LeaderBoard from "@/components/dashboard/LeaderBoard";
import RaceControl from "@/components/dashboard/RaceControl";
import TeamRadios from "@/components/dashboard/TeamRadios";
import TrackViolations from "@/components/dashboard/TrackViolations";
import Map from "@/components/dashboard/Map";
import CircleOfDoom from "@/components/dashboard/CircleOfDoom";
import VerticalOfDoom from "@/components/dashboard/VerticalOfDoom";
import { useSettingsStore } from "@/stores/useSettingsStore";
import Footer from "@/components/Footer";

export default function Page() {
    const layout = useSettingsStore((s) => s.circleLayout);
    return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-col gap-2 2xl:flex-row">
				<div className="overflow-x-auto">
					<LeaderBoard />
				</div>

				<div className="flex-1 2xl:max-h-[50rem]">
					<Map />
				</div>

				<div className={layout === "vertical" ? "flex-1 2xl:max-h-[70rem]" : "flex-1 2xl:max-h-[50rem]"}>
					{layout === "vertical" ? <VerticalOfDoom /> : <CircleOfDoom />}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-2 divide-y divide-zinc-800 *:h-[30rem] *:overflow-y-auto *:rounded-lg *:border *:border-zinc-800 *:p-2 md:divide-y-0 lg:grid-cols-3">
				<div>
					<RaceControl />
				</div>

				<div>
					<TeamRadios />
				</div>

				<div>
					<TrackViolations />
				</div>
			</div>

			<Footer />
		</div>
	);
}
