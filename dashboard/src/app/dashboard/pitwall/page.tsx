"use client";

import PitWall from "@/components/pitwall/PitWall";
import Footer from "@/components/Footer";

export default function PitWallPage() {
	return (
		<div className="flex w-full flex-col gap-2">
			<PitWall />

			<Footer />
		</div>
	);
}
