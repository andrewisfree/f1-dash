"use client";

import RaceControl from "@/components/dashboard/RaceControl";
import VerticalOfDoom from "@/components/dashboard/VerticalOfDoom";
import Footer from "@/components/Footer";

export default function VerticalPage() {
	return (
		<div className="flex min-h-full flex-col gap-2">
			<div className="grid min-h-[calc(100vh-6rem)] grid-cols-1 gap-2 xl:grid-cols-[1fr_minmax(20rem,24rem)]">
				<div className="min-h-[42rem]">
					<VerticalOfDoom />
				</div>

				<div className="h-[30rem] overflow-y-auto rounded-lg border border-zinc-800 p-2 xl:h-auto xl:max-h-[calc(100vh-6rem)]">
					<RaceControl />
				</div>
			</div>

			<Footer />
		</div>
	);
}
