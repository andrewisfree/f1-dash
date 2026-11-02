const CUTOFF: Record<number, number> = {
	1: 15,
	2: 10,
};

// last position that advances to the next part, the feed lists the entries of every part
export const getCutoffPosition = (sessionPart: number, noEntries?: number[]): number | undefined => {
	return noEntries?.[sessionPart] ?? CUTOFF[sessionPart];
};

export const inDangerZone = (position: number, sessionPart: number, noEntries?: number[]): boolean => {
	const cutoff = getCutoffPosition(sessionPart, noEntries);
	return cutoff !== undefined && position > cutoff;
};
