"use client";

import { useParams } from "next/navigation";

import DriverFocus from "@/components/driver/DriverFocus";

export default function DriverPage() {
	const { nr } = useParams<{ nr: string }>();

	return <DriverFocus nr={nr} />;
}
