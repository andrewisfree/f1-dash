import Image from "next/image";
import clsx from "clsx";

import type { Stint } from "@/types/state.type";

import { isNewTyre } from "@/lib/practice";
import { tireIcon } from "@/lib/tires";

type Props = {
	stint: Stint | undefined;
	// laps on the set, shown after the new or used mark
	age?: string | number | null;
};

export default function TyreTag({ stint, age }: Props) {
	if (!stint) return <span className="text-xs text-zinc-600">?</span>;

	const fresh = isNewTyre(stint);

	return (
		<span className="inline-flex items-center gap-1">
			<Image src={tireIcon(stint.Compound)} alt={stint.Compound ?? "unknown tire"} width={16} height={16} />
			<span className={clsx("text-xs tabular-nums", fresh ? "text-emerald-400" : "text-zinc-500")}>
				{fresh ? "N" : "U"}
				{age ?? ""}
			</span>
		</span>
	);
}
