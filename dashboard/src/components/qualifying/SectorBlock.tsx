import clsx from "clsx";

import type { PushSector } from "@/lib/qualifyingBoard";

type Props = {
	sector: PushSector | undefined;
	className?: string;
};

/**
 * a sector in the timing colors, purple for the best of the session, green for a personal
 * best and yellow for a slower one, grey while it is still to do
 */
export default function SectorBlock({ sector, className }: Props) {
	return (
		<span
			className={clsx(className, {
				"bg-violet-600 text-white": sector?.tone === "best",
				"bg-emerald-500 text-black": sector?.tone === "improved",
				"bg-amber-400 text-black": sector?.tone === "slower",
				"bg-zinc-800 text-zinc-600": !sector?.done,
			})}
		/>
	);
}
