import clsx from "clsx";

import type { Trend } from "@/lib/race";

type Props = {
	trend: Trend;
	className?: string;
};

export default function TrendText({ trend, className }: Props) {
	return (
		<span
			className={clsx(className, {
				"text-emerald-400": trend.tone === "closing",
				"text-red-400": trend.tone === "opening",
				"text-zinc-600": trend.tone === "stable",
			})}
		>
			{trend.text}
		</span>
	);
}
