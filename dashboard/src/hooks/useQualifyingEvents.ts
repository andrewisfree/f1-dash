"use client";

import { useEffect, useState } from "react";

import type { TimingData } from "@/types/state.type";

import { buildBoard } from "@/lib/qualifyingBoard";

import { useDataStore } from "@/stores/useDataStore";

// how long a row stays marked after its time or its place changed
const EVENT_MS = 8000;
// a new place and the lap time that earned it arrive within this
const SPLIT_MS = 3000;

// pole and improved for the car that set the time, dropped for the cars it passed, deleted for a lap taken away
export type QualifyingEventKind = "pole" | "improved" | "dropped" | "deleted";

export type QualifyingEvent = {
	kind: QualifyingEventKind;
	// places won, negative when lost
	places: number;
	id: number;
};

type Car = { position: number; seconds: number | null; out: boolean };

type Snapshot = { part: number | undefined; cars: Map<string, Car> };

function takeSnapshot(timingData: TimingData): Snapshot {
	const board = buildBoard(timingData);
	const cars = new Map<string, Car>();

	for (const row of board.rows) {
		cars.set(row.driver.RacingNumber, {
			position: row.position,
			seconds: row.seconds,
			out: row.state === "eliminated",
		});
	}

	return { part: board.part, cars };
}

function compare(before: Car, after: Car): QualifyingEventKind | null {
	if (after.out || before.out) return null;

	if (after.seconds !== null && (before.seconds === null || after.seconds < before.seconds)) {
		return after.position === 1 ? "pole" : "improved";
	}
	if (before.seconds !== null && (after.seconds === null || after.seconds > before.seconds)) return "deleted";
	if (after.position > before.position) return "dropped";

	return null;
}

/**
 * who just set a time in qualifying and who lost a place to it, for a few seconds
 */
export function useQualifyingEvents(): Map<string, QualifyingEvent> {
	const [events, setEvents] = useState<Map<string, QualifyingEvent>>(() => new Map());

	useEffect(() => {
		let previous: Snapshot | null = null;
		let timingData: TimingData | undefined;
		let counter = 0;
		// places won before the time arrived, and the last improvement of every car
		const pending = new Map<string, { position: number; at: number }>();
		const improved = new Map<string, { event: QualifyingEvent; at: number }>();
		const timers = new Set<ReturnType<typeof setTimeout>>();

		const unsubscribe = useDataStore.subscribe((store) => {
			// the store changes many times a second, the standings only with the timing data
			if (!store.state?.TimingData?.Lines || store.state.TimingData === timingData) return;
			timingData = store.state.TimingData;

			const next = takeSnapshot(timingData);
			const before = previous;
			previous = next;

			// a new part starts every time from scratch
			if (!before || before.part !== next.part) {
				pending.clear();
				improved.clear();
				return;
			}

			const now = Date.now();
			const found = new Map<string, QualifyingEvent>();
			next.cars.forEach((car, nr) => {
				const old = before.cars.get(nr);
				if (!old) return;

				const kind = compare(old, car);
				const gained = old.position - car.position;

				if (kind === "pole" || kind === "improved") {
					const from = pending.get(nr);
					pending.delete(nr);
					const event: QualifyingEvent = {
						kind,
						places: (from && now - from.at < SPLIT_MS ? from.position : old.position) - car.position,
						id: ++counter,
					};
					improved.set(nr, { event, at: now });
					found.set(nr, event);
				} else if (kind) {
					found.set(nr, { kind, places: gained, id: ++counter });
				} else if (gained > 0 && car.seconds === old.seconds) {
					// the time and the new place can come in separate messages, in either order
					const recent = improved.get(nr);
					if (recent && now - recent.at < SPLIT_MS) {
						const event: QualifyingEvent = {
							...recent.event,
							kind: car.position === 1 ? "pole" : recent.event.kind,
							places: recent.event.places + gained,
						};
						improved.set(nr, { event, at: recent.at });
						found.set(nr, event);
					} else if (!pending.has(nr)) {
						pending.set(nr, { position: old.position, at: now });
					}
				}
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
