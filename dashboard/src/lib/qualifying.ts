const CUTOFF: Record<number, number> = {
	1: 15,
	2: 10,
};

export const inDangerZone = (position: number, sessionPart: number): boolean => {
	const cutoff = CUTOFF[sessionPart];
	return cutoff !== undefined && position > cutoff;
};
