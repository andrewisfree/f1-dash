"use client";

import { useEffect, useState } from "react";

import type { Message, State } from "@/types/state.type";

import { getDriverFlags } from "@/lib/raceControl";

import { useDataStore } from "@/stores/useDataStore";

// how long a row stays lit after something happened to the car
const EVENT_MS = 3000;

export type RaceEventKind = "gain" | "loss" | "fastest" | "pit" | "flag" | "out";

export type RaceEvent = { kind: RaceEventKind; id: number };

// a car that stops or pits changes places for that reason, not for an overtake
const PRIORITY: RaceEventKind[] = ["out", "pit", "flag", "fastest", "gain", "loss"];

type Car = {
	position: number;
	inPit: boolean;
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
 * what just happened to every car, overtakes, fastest laps, stops and penalties, for a few seconds
 */
export function useRaceEvents(): Map<string, RaceEvent> {
	const [events, setEvents] = useState<Map<string, RaceEvent>>(() => new Map());

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
			if (!before || before.sessionKey !== next.sessionKey) return;

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

	return events;
}
