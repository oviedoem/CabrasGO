import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url = import.meta.env.VITE_API_URL || undefined;
    socket = url ? io(url, { path: "/socket.io" }) : io({ path: "/socket.io" });
  }
  return socket;
}
