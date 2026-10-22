import type { ClientToServerEvents, ServerToClientEvents } from '@igo/shared';
import { io, Socket } from 'socket.io-client';

export type IgoSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: IgoSocket | null = null;

export function getSocket(): IgoSocket {
  if (!socket) socket = io({ transports: ['websocket', 'polling'] });
  return socket;
}

/** Reconnects so that the server sees the new session cookie after login / logout. */
export function resetSocket() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

/** emit with an ack, as a promise. */
export function call<T = {}>(
  ev: keyof ClientToServerEvents,
  ...args: unknown[]
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getSocket().emit as any)(ev, ...args, resolve);
  });
}
