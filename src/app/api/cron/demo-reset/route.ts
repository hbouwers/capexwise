/**
 * The nightly demo reset (#34), as the HTTP call a scheduler makes. ADR-0011
 * is the decision, and ADR-0002 the reason it is a route: Vercel Cron and
 * Cloud Scheduler can both call a URL, so the move to Cloud Run changes who
 * calls this and nothing in it.
 *
 * `vercel.json` schedules it. `npm run demo:reset` calls it by hand, locally
 * or against a deployment.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { withoutParameters } from "@/lib/query-errors";
import { resetDemoOrg } from "@/server/demo";
import { env } from "@/server/env";

/**
 * Whether the request carries `Bearer <CRON_SECRET>`. Compared in constant
 * time over digests, which are the same length whatever was sent, so neither
 * the timing nor the length of a wrong guess says anything about the secret.
 */
function authorized(request: Request, secret: string): boolean {
  const digest = (value: string) =>
    new Uint8Array(createHash("sha256").update(value).digest());

  return timingSafeEqual(
    digest(request.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  );
}

export async function GET(request: Request): Promise<Response> {
  const secret = env().CRON_SECRET;

  // Off, and indistinguishable from a route that does not exist: where there
  // is no secret there is no demo to reset, and nothing to advertise.
  if (!secret) return new Response("Not Found", { status: 404 });

  if (!authorized(request, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await resetDemoOrg();

    // Counts and the org id. No visitor ids: they identify nobody, but a log
    // line is not the place to start deciding which ids are safe to print.
    console.info(
      `Demo reset: org ${summary.orgId}, ${summary.buildings} buildings, ` +
        `${summary.visitorsRemoved} visitors removed.`,
    );

    return Response.json(summary);
  } catch (error) {
    // Without the parameters: a failed insert's message carries every bound
    // value, and the access codes are among them — sealed, but still not the
    // log's to keep (CLAUDE.md).
    console.error(withoutParameters(error, "The demo reset").message);

    return new Response("The demo reset failed.", { status: 500 });
  }
}
