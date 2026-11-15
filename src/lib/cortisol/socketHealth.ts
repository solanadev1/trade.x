import WebSocket from 'ws';

// Exponential backoff with jitter. First retry lands in 125-250 ms, doubling to a ceiling.
export function reconnectDelay(attempt: number, baseMs = 250, capMs = 8000, random: () => number = Math.random) {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, Math.min(attempt, 16)));
  return Math.round(ceiling * (0.5 + 0.5 * random()));
}

export type SocketGuardOptions = {
  pingMs?: number;
  // Terminate when no data frame arrived for this long. Use only on subscriptions that are never quiet.
  staleMs?: number;
  lastData?: () => number;
};

// A dropped TCP path often never fires 'close'. Ping on a fixed cadence and terminate when the previous
// ping went unanswered, or when a busy subscription went silent. terminate() fires 'close', which is
// where callers already schedule their reconnect.
export function guardSocket(socket: WebSocket, options: SocketGuardOptions = {}) {
  const pingMs = options.pingMs ?? 3000;
  let answered = true;
  const onPong = () => { answered = true; };
  socket.on('pong', onPong);
  const timer = setInterval(() => {
    if (socket.readyState === WebSocket.CONNECTING) return;
    if (socket.readyState !== WebSocket.OPEN) { clearInterval(timer); return; }
    const silent = options.staleMs !== undefined && options.lastData !== undefined && Date.now() - options.lastData() > options.staleMs;
    if (!answered || silent) { clearInterval(timer); socket.terminate(); return; }
    answered = false;
    try { socket.ping(); } catch { clearInterval(timer); socket.terminate(); }
  }, pingMs);
  timer.unref();
  return () => { clearInterval(timer); socket.off('pong', onPong); };
}
