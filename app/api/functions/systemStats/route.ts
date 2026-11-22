import { readFile } from "node:fs/promises";
import os from "node:os";
import { getUser, json } from "@/lib/draftship-server";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const SAMPLE_WINDOW_MS = 220;
const FALLBACK_MEMORY_LIMIT = 512 * 1024 * 1024;

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** cgroup v2 first, then v1, then the host's own numbers. */
async function readCpuUsageUsec(): Promise<number | null> {
  const v2 = await readText("/sys/fs/cgroup/cpu.stat");
  if (v2) {
    const match = v2.match(/usage_usec\s+(\d+)/);
    if (match) return Number(match[1]);
  }
  const v1 = await readText("/sys/fs/cgroup/cpuacct/cpuacct.usage");
  if (v1) {
    const value = Number(v1);
    if (Number.isFinite(value)) return value / 1000;
  }
  return null;
}

async function readCpuLimitCores(): Promise<number | null> {
  const v2 = await readText("/sys/fs/cgroup/cpu.max");
  if (v2) {
    const [quotaRaw, periodRaw] = v2.split(/\s+/);
    if (quotaRaw && quotaRaw !== "max") {
      const quota = Number(quotaRaw);
      const period = Number(periodRaw);
      if (Number.isFinite(quota) && Number.isFinite(period) && period > 0) {
        return Math.max(0.1, quota / period);
      }
    }
  }
  const v1Quota = await readText("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
  const v1Period = await readText("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
  if (v1Quota && v1Period) {
    const quota = Number(v1Quota);
    const period = Number(v1Period);
    if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) {
      return Math.max(0.1, quota / period);
    }
  }
  return null;
}

async function readMemory(): Promise<{ used: number; limit: number }> {
  const currentV2 = await readText("/sys/fs/cgroup/memory.current");
  const maxV2 = await readText("/sys/fs/cgroup/memory.max");
  if (currentV2) {
    const used = Number(currentV2);
    const limit = maxV2 && maxV2 !== "max" ? Number(maxV2) : FALLBACK_MEMORY_LIMIT;
    if (Number.isFinite(used)) {
      return { used, limit: Number.isFinite(limit) && limit > 0 ? limit : FALLBACK_MEMORY_LIMIT };
    }
  }

  const usageV1 = await readText("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const limitV1 = await readText("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (usageV1) {
    const used = Number(usageV1);
    const rawLimit = limitV1 ? Number(limitV1) : FALLBACK_MEMORY_LIMIT;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit < 1e15 ? rawLimit : FALLBACK_MEMORY_LIMIT;
    if (Number.isFinite(used)) return { used, limit };
  }

  return {
    used: os.totalmem() - os.freemem(),
    limit: Math.min(os.totalmem(), FALLBACK_MEMORY_LIMIT),
  };
}

type CpuSample = { value: number; at: number; source: "cgroup" | "host" };

function hostCpuUsec(): number {
  let total = 0;
  for (const cpu of os.cpus()) {
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return total * 1000;
}

async function sampleCpu(): Promise<{ percent: number; cores: number }> {
  const limit = await readCpuLimitCores();
  const cores = limit ?? Math.max(1, os.cpus().length);

  const readSample = async (): Promise<CpuSample> => {
    const usage = await readCpuUsageUsec();
    if (usage !== null) return { value: usage, at: performance.now(), source: "cgroup" };
    return { value: hostCpuUsec(), at: performance.now(), source: "host" };
  };

  const first = await readSample();
  await sleep(SAMPLE_WINDOW_MS);
  const second = await readSample();

  const elapsedUsec = (second.at - first.at) * 1000;
  const usedUsec = Math.max(0, second.value - first.value);
  if (elapsedUsec <= 0) return { percent: 0, cores };

  const coresUsed = usedUsec / elapsedUsec;
  const percent = Math.min(100, Math.max(0, (coresUsed / cores) * 100));
  return { percent, cores };
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  // Every member sees the same shared container, so the numbers are not personal.

  try {
    const [cpu, memory] = await Promise.all([sampleCpu(), readMemory()]);
    const processMemory = process.memoryUsage();

    return json({
      cpuPercent: Math.round(cpu.percent * 10) / 10,
      cpuCores: Math.round(cpu.cores * 100) / 100,
      memoryUsedBytes: memory.used,
      memoryLimitBytes: memory.limit,
      memoryPercent: memory.limit > 0 ? Math.round((memory.used / memory.limit) * 1000) / 10 : 0,
      processRssBytes: processMemory.rss,
      heapUsedBytes: processMemory.heapUsed,
      uptimeSeconds: Math.round(process.uptime()),
      sampledAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The container stats could not be read.";
    return json({ error: message }, 400);
  }
}
