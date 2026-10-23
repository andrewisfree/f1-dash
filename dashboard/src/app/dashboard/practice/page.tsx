"use client";

import PracticeBoard from "@/components/practice/PracticeBoard";
import Footer from "@/components/Footer";

export default function PracticePage() {
	return (
		<div className="flex w-full flex-col gap-2">
			<PracticeBoard />

			<Footer />
		</div>
	);
}
