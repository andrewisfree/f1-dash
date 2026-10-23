import { motion } from "motion/react";
import { utc } from "moment";
import Image from "next/image";
import clsx from "clsx";

import type { Message } from "@/types/state.type";

import { useSettingsStore } from "@/stores/useSettingsStore";

import type { MessageTone } from "@/lib/raceControl";
import { toTrackTime } from "@/lib/toTrackTime";

type Props = {
	msg: Message;
	gmtOffset: string;
	// colours the message by how much it matters, plain when not given
	tone?: MessageTone;
};

const getDriverNumber = (msg: Message) => {
	const match = msg.Message.match(/CAR (\d+)/);
	return match?.[1];
};

export function RaceControlMessage({ msg, gmtOffset, tone }: Props) {
	const favoriteDriver = useSettingsStore((state) => state.favoriteDrivers.includes(getDriverNumber(msg) ?? ""));

	const localTime = utc(msg.Utc).local().format("HH:mm:ss");
	const trackTime = utc(toTrackTime(msg.Utc, gmtOffset)).format("HH:mm");

	return (
		<motion.li
			layout="position"
			animate={{ opacity: 1, scale: 1 }}
			initial={{ opacity: 0, scale: 0.8 }}
			className={clsx("flex items-center justify-between gap-1 rounded-lg p-2", {
				"bg-sky-800/30": favoriteDriver,
				"rounded-l-none border-l-4": tone && tone !== "normal" && tone !== "info",
				"border-l-red-500 bg-red-950/40": tone === "red" || tone === "penalty",
				"border-l-amber-400 bg-amber-950/30": tone === "yellow",
				"border-l-amber-600": tone === "investigation",
				"py-1 text-zinc-500": tone === "info",
			})}
		>
			<div>
				<div className="flex items-center gap-1 text-sm leading-none text-zinc-500">
					{msg.Lap && (
						<>
							<p>Lap {msg.Lap}</p>
							{"·"}
						</>
					)}
					<time dateTime={localTime}>{localTime}</time>
					{"·"}
					<time className="text-zinc-700" dateTime={trackTime}>
						{trackTime}
					</time>
				</div>

				<p
					className={clsx(tone === "info" ? "text-xs" : "text-sm", {
						"font-semibold": tone === "red" || tone === "penalty",
					})}
				>
					{msg.Message}
				</p>
			</div>

			{msg.Flag && msg.Flag !== "CLEAR" && (
				<Image
					src={`/flags/${msg.Flag.toLowerCase().replaceAll(" ", "-")}-flag.svg`}
					alt={msg.Flag}
					width={25}
					height={25}
				/>
			)}
		</motion.li>
	);
}
