import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";

import { useSettingsStore } from "@/stores/useSettingsStore";
import { useDataStore } from "@/stores/useDataStore";

import { getMessageTone } from "@/lib/raceControl";
import { sortUtc } from "@/lib/sorting";

import { RaceControlMessage } from "@/components/dashboard/RaceControlMessage";

// deleted laps of these first cars still count
const FRONT = 10;

type Props = {
	// colour the messages by importance and fade the service ones
	prioritize?: boolean;
};

export default function RaceControl({ prioritize = false }: Props) {
	const messages = useDataStore((state) => state.state?.RaceControlMessages?.Messages);
	const lines = useDataStore((state) => state.state?.TimingData?.Lines);
	const front = useMemo(
		() =>
			new Set(
				Object.values(lines ?? {})
					.filter((driver) => parseInt(driver.Position) <= FRONT)
					.map((driver) => driver.RacingNumber),
			),
		[lines],
	);
	const gmtOffset = useDataStore((state) => state.state?.SessionInfo?.GmtOffset);

	const raceControlChime = useSettingsStore((state) => state.raceControlChime);
	const raceControlChimeVolume = useSettingsStore((state) => state.raceControlChimeVolume);

	const chimeRef = useRef<HTMLAudioElement | null>(null);
	const pastMessageTimestamps = useRef<string[] | null>(null);

	useEffect(() => {
		if (typeof window !== "undefined") {
			const chime = new Audio("/sounds/chime.mp3");
			chime.volume = raceControlChimeVolume / 100;
			chimeRef.current = chime;

			return () => {
				chimeRef.current = null;
			};
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;

		if (messages === undefined || messages === null) return;

		if (!pastMessageTimestamps.current) {
			pastMessageTimestamps.current = messages.map((msg) => msg.Utc);
			return;
		}

		const newMessages = messages.filter((msg) => !pastMessageTimestamps.current?.includes(msg.Utc));

		if (newMessages.length > 0 && raceControlChime) {
			chimeRef.current?.play();
		}

		pastMessageTimestamps.current = messages.map((msg) => msg.Utc);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messages]);

	return (
		<ul className="flex flex-col gap-2">
			{!messages &&
				new Array(7).fill("").map((_, index) => <SkeletonMessage key={`msg.loading.${index}`} index={index} />)}

			{messages && gmtOffset && (
				<AnimatePresence>
					{messages
						.sort(sortUtc)
						.filter((msg) => (msg.Flag ? msg.Flag.toLowerCase() !== "blue" : true))
						.map((msg, i) => (
							<RaceControlMessage
								key={`msg.${i}`}
								msg={msg}
								gmtOffset={gmtOffset}
								tone={prioritize ? getMessageTone(msg, front) : undefined}
							/>
						))}
				</AnimatePresence>
			)}
		</ul>
	);
}

const SkeletonMessage = ({ index }: { index: number }) => {
	const animateClass = "h-6 animate-pulse rounded-md bg-zinc-800";

	const flag = index % 4 === 0;
	const long = index % 5 === 0;
	const mid = index % 3 === 0;

	return (
		<li className="flex flex-col gap-1 p-2">
			<div className={clsx(animateClass, "h-4! w-16")} />

			<div className="flex gap-1">
				{flag && <div className={clsx(animateClass, "w-6")} />}
				<div className={animateClass} style={{ width: long ? "100%" : mid ? "75%" : "40%" }} />
			</div>
		</li>
	);
};
