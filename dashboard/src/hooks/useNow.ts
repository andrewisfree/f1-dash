"use client";

import { useEffect, useState } from "react";

/**
 * the current time, refreshed every interval, for clocks counting down
 */
export function useNow(interval: number) {
	const [now, setNow] = useState<number>(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), interval);
		return () => clearInterval(timer);
	}, [interval]);

	return now;
}
