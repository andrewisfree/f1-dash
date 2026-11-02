"use client";

import { useEffect, useState } from "react";

import type { Message, State } from "@/types/state.type";

import { getDriverFlags } from "@/lib/raceControl";

import { useDataStore } from "@/stores/useDataStore";

// how long a row stays lit after something happened to the car
const EVENT_MS = 3000;
// events kept in the log, the newest first
const LOG_SIZE = 6;

export type RaceEventKind = "gain" | "loss" | "fastest" | "pit" | "flag" | "out";

export type RaceEvent = { kind: RaceEventKind; id: number };

export type RaceLogEntry = {
	id: number;
	// lap of the leader when it happened
	lap: number | null;
	kind: Exclude<RaceEventKind, "loss">;
	nr: string;
	// the car passed in an overtake
	passed?: string;
	position?: number;
	// the lap time of a fastest lap, the seconds of a penalty
	detail?: string;
};

// a car that stops or pits changes places for that reason, not for an overtake
const PRIORITY: RaceEventKind[] = ["out", "pit", "flag", "fastest", "gain", "loss"];

type Car = {
	position: number;
	inPit: boolean;
	// in the pit lane, a car on its out lap can still be passed on track
	pitLane: boolean;
	out: boolean;
	lastLap: string | undefined;
	fastest: boolean;
	penalty: number;
	investigation: boolean;
};

type Snapshot = { sessionKey: number | null; cars: Map<string, Car> };

function takeSnapshot(state: State, flags: ReturnType<typeof getDriverFlags>): Snapshot {
	const cars = new Map<string, Car>();

	for (const driver of Object.values(state.TimingData?.Lines ?? {})) {
		const carFlags = flags.get(driver.RacingNumber);
		cars.set(driver.RacingNumber, {
			position: parseInt(driver.Position),
			inPit: !!(driver.InPit || driver.PitOut),
			pitLane: !!driver.InPit,
			out: !!(driver.Retired || driver.Stopped),
			lastLap: driver.LastLapTime?.Value,
			fastest: !!driver.LastLapTime?.OverallFastest,
			penalty: carFlags?.penalty ?? 0,
			investigation: !!carFlags?.investigation,
		});
	}

	return { sessionKey: state.SessionInfo?.Key ?? null, cars };
}

function compare(before: Car, after: Car): RaceEventKind | null {
	const found: RaceEventKind[] = [];

	if (after.out && !before.out) found.push("out");
	if (after.inPit && !before.inPit) found.push("pit");
	if (after.penalty > before.penalty || (after.investigation && !before.investigation)) found.push("flag");
	if (after.fastest && (!before.fastest || after.lastLap !== before.lastLap)) found.push("fastest");
	if (Number.isFinite(before.position) && Number.isFinite(after.position)) {
		if (after.position < before.position) found.push("gain");
		if (after.position > before.position) found.push("loss");
	}

	return PRIORITY.find((kind) => found.includes(kind)) ?? null;
}

/**
 * what happened between two states, for the log: places won in the pits or because a car stopped are
 * not overtakes, the place is only logged when the car passed was on track
 */
function describe(before: Snapshot, after: Snapshot, lap: number | null, next: () => number): RaceLogEntry[] {
	const entries: RaceLogEntry[] = [];

	after.cars.forEach((car, nr) => {
		const old = before.cars.get(nr);
		if (!old) return;

		if (car.out && !old.out) entries.push({ id: next(), lap, kind: "out", nr });
		if (car.pitLane && !old.pitLane) entries.push({ id: next(), lap, kind: "pit", nr, position: car.position });
		if (car.penalty > old.penalty) {
			entries.push({ id: next(), lap, kind: "flag", nr, detail: `+${car.penalty - old.penalty}s` });
		} else if (car.investigation && !old.investigation) {
			entries.push({ id: next(), lap, kind: "flag", nr, detail: "investigation" });
		}
		if (car.fastest && (!old.fastest || car.lastLap !== old.lastLap)) {
			entries.push({ id: next(), lap, kind: "fastest", nr, detail: car.lastLap });
		}

		if (!(car.position < old.position) || car.out || car.pitLane) return;
		// the cars this one went past, the nearest first
		const passed = Array.from(after.cars.entries())
			.filter(([other, otherCar]) => {
				const was = before.cars.get(other);
				return (
					other !== nr &&
					was &&
					was.position >= car.position &&
					was.position < old.position &&
					otherCar.position > car.position &&
					!otherCar.pitLane &&
					!otherCar.out
				);
			})
			.sort((a, b) => a[1].position - b[1].position);
		if (passed.length > 0) {
			entries.push({ id: next(), lap, kind: "gain", nr, passed: passed[0][0], position: car.position });
		}
	});

	return entries;
}

/**
 * what just happened to every car, overtakes, fastest laps, stops and penalties, for a few seconds,
 * and a log of the last of them
 */
export function useRaceEvents(): { events: Map<string, RaceEvent>; log: RaceLogEntry[] } {
	const [events, setEvents] = useState<Map<string, RaceEvent>>(() => new Map());
	const [log, setLog] = useState<RaceLogEntry[]>([]);

	useEffect(() => {
		let previous: Snapshot | null = null;
		let messages: Message[] | undefined;
		let flags = getDriverFlags(undefined);
		let counter = 0;
		const timers = new Set<ReturnType<typeof setTimeout>>();

		const unsubscribe = useDataStore.subscribe((store) => {
			const state = store.state;
			if (!state?.TimingData?.Lines) return;

			// the flags only change with a new race control message
			if (state.RaceControlMessages?.Messages !== messages) {
				messages = state.RaceControlMessages?.Messages;
				flags = getDriverFlags(messages);
			}

			const next = takeSnapshot(state, flags);
			const before = previous;
			previous = next;

			// the first state and a new session have nothing to compare with
			if (!before || before.sessionKey !== next.sessionKey) {
				if (before) setLog([]);
				return;
			}

			// in practice and qualifying places change with the lap times, not on track
			const logged =
				state.SessionInfo?.Type === "Race"
					? describe(before, next, state.LapCount?.CurrentLap ?? null, () => ++counter)
					: [];
			if (logged.length > 0) setLog((current) => [...logged.reverse(), ...current].slice(0, LOG_SIZE));

			const found = new Map<string, RaceEvent>();
			next.cars.forEach((car, nr) => {
				const old = before.cars.get(nr);
				const kind = old ? compare(old, car) : null;
				if (kind) found.set(nr, { kind, id: ++counter });
			});
			if (found.size === 0) return;

			setEvents((current) => new Map([...Array.from(current.entries()), ...Array.from(found.entries())]));

			const timer = setTimeout(() => {
				timers.delete(timer);
				setEvents((current) => {
					const remaining = new Map(current);
					found.forEach((event, nr) => {
						if (remaining.get(nr)?.id === event.id) remaining.delete(nr);
					});
					return remaining;
				});
			}, EVENT_MS);
			timers.add(timer);
		});

		return () => {
			unsubscribe();
			timers.forEach(clearTimeout);
		};
	}, []);

	return { events, log };
}
