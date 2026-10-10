import type { ReactNode } from "react";
import clsx from "clsx";

type Props = {
	className: string;
	children: ReactNode;
};

export default function Badge({ className, children }: Props) {
	return (
		<span
			className={clsx("shrink-0 rounded border px-1 text-[10px] leading-4 font-black whitespace-nowrap", className)}
		>
			{children}
		</span>
	);
}
