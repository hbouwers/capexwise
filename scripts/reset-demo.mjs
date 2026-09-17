/**
 * Resets the demo org by hand: `npm run demo:reset`, or
 * `npm run demo:reset -- https://capexwise.com` for a deployment.
 *
 * It calls the route the nightly schedule calls, `/api/cron/demo-reset`, rather
 * than writing the demo itself (ADR-0011). There is one reset, and it runs in
 * the application, where the schema, the scoped role and the access-code
 * keyring already are — a second copy here would need all three, and the
 * keyring is exactly the secret that should not be copied anywhere new.
 *
 * So locally it needs `npm run dev` running and `CRON_SECRET` in `.env.local`.
 * Against a deployment it needs that deployment's `CRON_SECRET` in the
 * environment of this shell.
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const origin = (process.argv[2] ?? process.env.APP_URL ?? "").replace(
  /\/$/,
  "",
);
const secret = process.env.CRON_SECRET;

if (!origin || !secret) {
  console.error(
    "Needs an origin — an argument, or APP_URL — and CRON_SECRET. " +
      ".env.example says how to generate the secret.",
  );
  process.exit(1);
}

const response = await fetch(`${origin}/api/cron/demo-reset`, {
  headers: { authorization: `Bearer ${secret}` },
}).catch((error) => {
  console.error(
    `Could not reach ${origin}: ${error.cause?.code ?? error.message}. Is the server running?`,
  );
  process.exit(1);
});

const body = await response.text();

if (!response.ok) {
  console.error(`${response.status} from ${origin}: ${body}`);
  process.exit(1);
}

console.log(body);
