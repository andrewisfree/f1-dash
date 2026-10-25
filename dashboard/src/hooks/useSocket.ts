import { useEffect, useState } from "react";

import type { MessageInitial, MessageUpdate } from "@/types/message.type";

import { env } from "@/env";

type Props = {
	handleInitial: (data: MessageInitial) => void;
	handleUpdate: (data: MessageUpdate) => void;
	// runs before the live feed opens, the updates it brings must come before the live ones
	before?: () => Promise<void>;
};

export const useSocket = ({ handleInitial, handleUpdate, before }: Props) => {
	const [connected, setConnected] = useState<boolean>(false);

	useEffect(() => {
		let sse: EventSource | null = null;
		let closed = false;

		const open = () => {
			if (closed) return;

			sse = new EventSource(`${env.NEXT_PUBLIC_LIVE_URL}/api/realtime`);

			sse.onerror = () => setConnected(false);
			sse.onopen = () => setConnected(true);

			sse.addEventListener("initial", (message) => {
				handleInitial(JSON.parse(message.data));
			});

			sse.addEventListener("update", (message) => {
				handleUpdate(JSON.parse(message.data));
			});
		};

		if (before) before().finally(open);
		else open();

		return () => {
			closed = true;
			sse?.close();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { connected };
};
