import type { Message } from "@/types/state.type";

export type DriverFlags = {
	// pending time penalty in seconds
	penalty: number;
	trackLimits: number;
	investigation: boolean;
	warning: boolean;
};

const emptyFlags = (): DriverFlags => ({ penalty: 0, trackLimits: 0, investigation: false, warning: false });

const findCars = (message: string): string[] =>
	(message.match(/\d+ \([A-Z]{3}\)/g) ?? []).map((car) => car.split(" ")[0]);

export function getDriverFlags(messages: Message[] | undefined): Map<string, DriverFlags> {
	const flags = new Map<string, DriverFlags>();
	if (!messages) return flags;

	const get = (nr: string) => {
		const current = flags.get(nr) ?? emptyFlags();
		flags.set(nr, current);
		return current;
	};

	const ordered = [...messages].sort((a, b) => a.Utc.localeCompare(b.Utc));

	for (const msg of ordered) {
		const text = msg.Message.toUpperCase();
		const cars = findCars(text);

		const penalty = text.match(/(\d+) SECOND TIME PENALTY FOR CAR (\d+)/);
		if (penalty) {
			const driver = get(penalty[2]);
			const seconds = parseInt(penalty[1], 10);
			driver.penalty = text.includes("PENALTY SERVED")
				? Math.max(0, driver.penalty - seconds)
				: driver.penalty + seconds;
		}

		if (msg.Category === "Other" && text.includes("TRACK LIMITS") && !text.includes("PENALTY")) {
			const car = text.match(/CAR (\d+)/)?.[1];
			if (car) get(car).trackLimits++;
		}

		if (msg.Flag === "BLACK AND WHITE") {
			const car = text.match(/CAR (\d+)/)?.[1];
			if (car) get(car).warning = true;
		}

		if (text.includes("UNDER INVESTIGATION")) {
			cars.forEach((car) => (get(car).investigation = true));
		} else if (text.includes("NO FURTHER") || text.includes("PENALTY FOR CAR")) {
			cars.forEach((car) => (get(car).investigation = false));
		}
	}

	return flags;
}

export type MessageTone = "red" | "yellow" | "penalty" | "investigation" | "normal" | "info";

// service messages that rarely change what happens on track
const INFO = /GRIP|OVERTAKE|DRS |DRS$|CLEAR IN TRACK|GREEN LIGHT|PIT EXIT (OPEN|CLOSED)|RISK OF RAIN|TRACK SURFACE/;

/**
 * how much a race control message matters, deleted laps only count for the cars at the front
 */
export function getMessageTone(msg: Message, front: Set<string>): MessageTone {
	const text = msg.Message.toUpperCase();

	if (msg.Flag === "RED") return "red";
	if (msg.Category === "SafetyCar" || msg.Flag === "YELLOW" || msg.Flag === "DOUBLE YELLOW") return "yellow";
	if (text.includes("PENALTY") && !text.includes("NO FURTHER")) return "penalty";
	if (text.includes("INVESTIGATION") || text.includes("NOTED")) return "investigation";
	if (text.includes("DELETED")) {
		const car = text.match(/CAR (\d+)/)?.[1];
		return car && front.has(car) ? "normal" : "info";
	}
	if (msg.Flag === "CLEAR" || msg.Flag === "GREEN" || INFO.test(text)) return "info";
	return "normal";
}
