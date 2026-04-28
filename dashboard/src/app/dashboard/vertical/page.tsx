"use client";

import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";

import VerticalOfDoom from "@/components/dashboard/VerticalOfDoom";
import DriverDRS from "@/components/driver/DriverDRS";
import DriverGap from "@/components/driver/DriverGap";
import DriverInfo from "@/components/driver/DriverInfo";
import DriverLapTime from "@/components/driver/DriverLapTime";
import DriverTag from "@/components/driver/DriverTag";
import Footer from "@/components/Footer";
import { inDangerZone } from "@/lib/qualifying";
import { sortPos } from "@/lib/sorting";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { Driver, TimingDataDriver } from "@/types/state.type";

const hasDRS = (drs: number) => drs > 9;
const possibleDRS = (drs: number) => drs === 8;

export default function VerticalPage() {
	const drivers = useDataStore((state) => state.state?.DriverList);
	const driversTiming = useDataStore((state) => state.state?.TimingData);

	return (
		<div className="flex min-h-full flex-col gap-2">
			<div className="grid min-h-[calc(100vh-6rem)] grid-cols-1 gap-2 xl:grid-cols-[minmax(31rem,34rem)_1fr]">
				<div className="order-2 flex min-h-[30rem] flex-col gap-0.5 overflow-x-auto overflow-y-auto rounded-lg border border-zinc-800 p-2 xl:order-1">
					{(!drivers || !driversTiming) &&
						new Array(20).fill("").map((_, index) => <SkeletonDriver key={`driver.loading.${index}`} />)}

					{drivers && driversTiming && (
						<AnimatePresence>
							{Object.values(driversTiming.Lines)
								.sort(sortPos)
								.map((timingDriver, index) => (
									<VODDriver
										key={`vod.driver.${timingDriver.RacingNumber}`}
										position={index + 1}
										driver={drivers[timingDriver.RacingNumber]}
										timingDriver={timingDriver}
									/>
								))}
						</AnimatePresence>
					)}
				</div>

				<div className="order-1 min-h-[42rem] xl:order-2">
					<VerticalOfDoom />
				</div>
			</div>

			<Footer />
		</div>
	);
}

type VODDriverProps = {
	position: number;
	driver: Driver;
	timingDriver: TimingDataDriver;
};

function VODDriver({ position, driver, timingDriver }: VODDriverProps) {
	const sessionPart = useDataStore((state) => state.state?.TimingData?.SessionPart);
	const timingStatsDriver = useDataStore((state) => state.state?.TimingStats?.Lines[driver.RacingNumber]);
	const appTimingDriver = useDataStore((state) => state.state?.TimingAppData?.Lines[driver.RacingNumber]);
	const carData = useDataStore((state) => state.carsData?.[driver.RacingNumber]?.Channels);
	const favoriteDriver = useSettingsStore((state) => state.favoriteDrivers.includes(driver.RacingNumber));
	const hasFastest = timingStatsDriver?.PersonalBestLapTime.Position === 1;

	return (
		<motion.div
			layout="position"
			className={clsx("min-w-[31rem] rounded-lg p-1.5 select-none", {
				"opacity-50": timingDriver.KnockedOut || timingDriver.Retired || timingDriver.Stopped,
				"bg-sky-800/30": favoriteDriver,
				"bg-violet-800/30": hasFastest,
				"bg-red-800/30": sessionPart !== undefined && inDangerZone(position, sessionPart),
			})}
		>
			<div className="grid items-center gap-2" style={{ gridTemplateColumns: "5.5rem 3.5rem 4rem 5rem 5rem" }}>
				<DriverTag className="min-w-full!" short={driver.Tla} teamColor={driver.TeamColour} position={position} />
				<DriverDRS
					on={carData ? hasDRS(carData[45]) : false}
					possible={carData ? possibleDRS(carData[45]) : false}
					inPit={timingDriver.InPit}
					pitOut={timingDriver.PitOut}
				/>
				<DriverInfo timingDriver={timingDriver} gridPos={appTimingDriver ? parseInt(appTimingDriver.GridPos) : 0} />
				<DriverGap timingDriver={timingDriver} sessionPart={sessionPart} />
				<DriverLapTime last={timingDriver.LastLapTime} best={timingDriver.BestLapTime} hasFastest={hasFastest} />
			</div>
		</motion.div>
	);
}

function SkeletonDriver() {
	const animateClass = "h-8 animate-pulse rounded-md bg-zinc-800";

	return (
		<div
			className="grid min-w-[31rem] place-items-center items-center gap-1 p-1"
			style={{ gridTemplateColumns: "5.5rem 4rem 5.5rem 5rem 5rem" }}
		>
			<div className={animateClass} style={{ width: "100%" }} />
			<div className={animateClass} style={{ width: "90%" }} />
			{new Array(2).fill(null).map((_, index) => (
				<div className="flex w-full flex-col gap-1" key={`skeleton.${index}`}>
					<div className={clsx(animateClass, "h-4!")} />
					<div className={clsx(animateClass, "h-3! w-2/3")} />
				</div>
			))}
			<div className="flex w-full flex-col gap-1">
				<div className={clsx(animateClass, "h-3! w-4/5")} />
				<div className={clsx(animateClass, "h-4!")} />
			</div>
		</div>
	);
}
