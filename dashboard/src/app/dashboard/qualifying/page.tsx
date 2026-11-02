"use client";

import QualifyingBoard from "@/components/qualifying/QualifyingBoard";
import Footer from "@/components/Footer";

export default function QualifyingPage() {
	return (
		<div className="flex w-full flex-col gap-2">
			<QualifyingBoard />

			<Footer />
		</div>
	);
}
