import { createServiceClient, getUser, json } from "@/lib/draftship-server";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const role = (user as unknown as { role?: string }).role;
  if (role !== "admin") return json({ error: "Only the app owner can stop runs." }, 403);

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(await req.json());
  } catch {
    return json({ error: "The request body could not be read." }, 400);
  }

  const clientKey = typeof payload.clientKey === "string" ? payload.clientKey : "";
  if (!clientKey) return json({ error: "The run is missing its key." }, 400);

  const ds = createServiceClient(req);

  try {
    const records = await ds.entities.TestRun.filter({ clientKey }, "-created_date");
    const running = records.map(asRecord).find((record) => record.status === "running");
    if (!running) return json({ error: "No running test was found for this key." }, 404);

    const runId = String(running.id ?? "");
    if (!runId) return json({ error: "No running test was found for this key." }, 404);

    await ds.entities.TestRun.update(runId, { stopRequested: true });
    return json({ ok: true, runId });
  } catch {
    return json({ error: "The run could not be stopped." }, 500);
  }
}
