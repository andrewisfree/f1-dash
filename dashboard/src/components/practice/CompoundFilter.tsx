import Image from "next/image";
import clsx from "clsx";

import type { Stint } from "@/types/state.type";

import { tireIcon } from "@/lib/tires";

export type Compound = NonNullable<Stint["Compound"]>;

type Props = {
	compounds: Compound[];
	value: Compound | null;
	onChange: (value: Compound | null) => void;
};

export default function CompoundFilter({ compounds, value, onChange }: Props) {
	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				onClick={() => onChange(null)}
				className={clsx(
					"rounded px-2 py-0.5 text-xs",
					value === null ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
				)}
			>
				All
			</button>

			{compounds.map((compound) => (
				<button
					key={`compound.${compound}`}
					type="button"
					title={compound}
					onClick={() => onChange(value === compound ? null : compound)}
					className={clsx("rounded p-1", value === compound ? "bg-zinc-700" : "opacity-60 hover:opacity-100")}
				>
					<Image src={tireIcon(compound)} alt={compound} width={16} height={16} />
				</button>
			))}
		</div>
	);
}
