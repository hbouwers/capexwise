# syntax=docker/dockerfile:1

# The escape hatch from ADR-0002, kept green rather than kept around. Vercel Hobby
# forbids commercial use, so Stripe going live forces a move to Cloud Run — and the
# difference between that being an afternoon and being a project is whether this
# file has been built and run today. CI builds it on every pull request (#19, #22)
# for exactly that reason: an image nobody has run is documentation, not a hatch.
#
# It does NOT run migrations. Those run in CI on a push to `main`, never at boot
# and never in a build — ADR-0006 has the reasoning. The container serves, only.

# Pinned by digest, not by tag. `node:24-alpine` moves under you, so a build that
# passed last week and fails today gives no clue why. The tag is kept alongside so
# the digest is legible; bump both together.
#
# Alpine is safe here in a way it is not for Postgres. `docker-compose.yml` takes
# the Debian image deliberately, because musl's collation disagrees with the
# glibc/ICU collation managed providers run and `ORDER BY` on text would differ
# between a laptop and production. Nothing in this image sorts text in a database.
ARG NODE_IMAGE=node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf


# --- deps -------------------------------------------------------------------
# Dependencies in their own stage so a source-only change does not reinstall them.
FROM ${NODE_IMAGE} AS deps

# The SWC binary and the `next/font` toolchain are glibc-linked in places and fall
# back to needing this shim on musl. It is a few hundred kilobytes and it is only
# in the build stages.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# `.npmrc` sets engine-strict, so a base image that drifted off Node 24 fails here
# rather than producing a subtly different build.
COPY package.json package-lock.json .npmrc ./

# Dev dependencies are needed: TypeScript and Tailwind run at build time. So
# NODE_ENV stays unset until the runner stage — setting it to production here
# would make `npm ci` skip exactly the packages the build needs.
RUN npm ci


# --- builder ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# `output: "standalone"` in next.config.ts is what makes this stage useful: it
# writes a self-contained server plus only the node_modules it traced as reachable
# — 40MB against the 646MB a full install weighs, so the runner below copies an
# order of magnitude less than it otherwise would.
#
# The build needs network access, because `next/font/google` downloads the IBM Plex
# files at build time to self-host them. It does not need DATABASE_URL — nothing in
# the application connects to the database yet, and when it does, ADR-0006 keeps
# that out of the build.
RUN npm run build


# --- runner -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

# HOSTNAME is the one that is not obvious: the standalone server binds 127.0.0.1
# by default, which inside a container means nothing outside it can connect, and
# the failure looks like the app never started rather than like a bind address.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `node` (uid 1000) ships with the base image, so there is no user to create. The
# application is never the thing that writes to its own image.
USER node

# Two directories, because standalone deliberately splits them: `standalone` is the
# server and its traced dependencies, `static` is the hashed asset output that the
# server expects to find but does not trace. Copying only the first produces a
# container that starts, serves HTML, and renders unstyled — a failure that looks
# like a CSS bug rather than a packaging one.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# There is no `public/` in this repository yet. When one arrives it is copied here
# too — standalone does not trace it either.

EXPOSE 3000

# Cloud Run ignores this, and that is fine; it is here for the local compose run and
# for anything else that reads container health. `node` rather than curl or wget so
# it depends on nothing the image would not otherwise have.
#
# `/sign-in` rather than `/`, because `/` is a protected route (#25) and answers a
# request with no cookie by redirecting here. `fetch` would follow that and still
# report healthy, so this is not a fix — it is the check asking the question it
# means: does the server render a page. `/sign-in` is also the one route that
# reaches neither the database nor Google, so an unhealthy container here means the
# process, not its dependencies.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `server.js`, not `next start`. The standalone output has no `next` binary in it —
# that is the point of it.
CMD ["node", "server.js"]
