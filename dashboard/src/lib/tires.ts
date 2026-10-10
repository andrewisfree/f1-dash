export function tireIcon(compound?: string) {
	const normalized = compound?.toLowerCase();
	return ["soft", "medium", "hard", "intermediate", "wet"].includes(normalized ?? "")
		? `/tires/${normalized}.svg`
		: "/tires/unknown.svg";
}
