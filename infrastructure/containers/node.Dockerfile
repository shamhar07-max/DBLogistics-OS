# One multi-stage file builds every deployable from the same lockfile. Web, API and worker ship as separate images.
FROM node:22-bookworm-slim AS base
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/staff-web/package.json apps/staff-web/
COPY apps/partner-portal/package.json apps/partner-portal/
COPY packages packages
RUN npm ci
COPY . .

FROM base AS tooling
CMD ["npx", "tsx", "database/migrate.ts"]

FROM base AS build-api
RUN npm run build -w @dbl/api
FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-api /repo/apps/api/dist ./dist
COPY --from=build-api /repo/node_modules ./node_modules
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM base AS build-worker
RUN npm run build -w @dbl/worker
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-worker /repo/apps/worker/dist ./dist
COPY --from=build-worker /repo/node_modules ./node_modules
USER node
CMD ["node", "dist/main.js"]

FROM base AS build-staff
ENV SESSION_SECRET=build-time-placeholder-build-time-placeholder-0 OIDC_ISSUER_URL=https://placeholder.invalid OIDC_WEB_CLIENT_ID=x OIDC_WEB_CLIENT_SECRET=x NODE_ENV=production
RUN npm run build -w @dbl/staff-web
FROM node:22-bookworm-slim AS staff-web
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build-staff /repo /repo
USER node
WORKDIR /repo/apps/staff-web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
