export const LIMITS = {
  minConcurrency: 1,
  maxConcurrency: 300,
  defaultConcurrency: 100,
  minDuration: 3,
  maxDuration: 45,
  defaultDuration: 15,
  maxRequests: 400_000,
  maxPoolPorts: 50,
  defaultPoolPorts: 10,
  requestTimeoutMs: 12_000,
} as const;

export const CONCURRENCY_PRESETS = [25, 50, 100, 200, 300];
export const DURATION_PRESETS = [5, 10, 15, 30, 45];
export const POOL_PRESETS = [1, 5, 10, 25, 50];

export function formatPortRange(ports: number[]): string {
  if (ports.length === 0) return "—";
  if (ports.length === 1) return String(ports[0]);
  return `${ports[0]}–${ports[ports.length - 1]}`;
}
