/**
 * Every Better Auth endpoint, mounted in one place: sign-in, the OAuth callback,
 * sign-out, session reads, and the organization plugin's routes.
 *
 * The path is `/api/auth/[...all]` because that is the default the client and
 * `baseURL` both assume. Moving it means configuring it in three places and
 * re-registering the redirect URI with Google, for nothing.
 *
 * This is the only route in the application that is not ours. Nothing else
 * belongs in this file — an endpoint written here would be an endpoint outside
 * the org scoping every other write goes through.
 */
import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth";

// Wrapped per request rather than destructured at module scope, and that shape
// is the whole reason `getAuth()` is a function — see `src/server/env.ts`.
// `next build` imports this module to collect the route's configuration, and a
// provider built during that import would make the build demand a
// `BETTER_AUTH_SECRET` and a Google client. `getAuth()` is memoised and
// `toNextJsHandler` only closes over the instance it is given, so what this
// costs per request is an object literal, not a provider.
export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
