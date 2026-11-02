import { utc } from "moment";

type PosObject = { Position: string };
export const sortPos = (a: PosObject, b: PosObject) => {
	return parseInt(a.Position) - parseInt(b.Position);
};

type PosObjectQuali = {
	Sectors: {
		Segments: { Status: number }[];
	}[];
	BestLapTime: { Value: string };
};
export const sortQuali = (a: PosObjectQuali, b: PosObjectQuali) => {
	const aPassed = a.Sectors.flatMap((sector) => sector.Segments).filter((s) => s.Status > 0).length;
	const bPassed = b.Sectors.flatMap((sector) => sector.Segments).filter((s) => s.Status > 0).length;

	if (bPassed !== aPassed) return bPassed - aPassed;

	// tiebreak: lower best lap time first
	if (a.BestLapTime.Value && b.BestLapTime.Value) return a.BestLapTime.Value.localeCompare(b.BestLapTime.Value);
	if (a.BestLapTime.Value) return -1;
	if (b.BestLapTime.Value) return 1;
	return 0;
};

type UtcObject = { Utc: string };
export const sortUtc = (a: UtcObject, b: UtcObject) => {
	return utc(b.Utc).diff(utc(a.Utc));
};
