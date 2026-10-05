FROM node:22-bookworm-slim AS base
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/staff-web/package.json apps/staff-web/
COPY apps/partner-portal/package.json apps/partner-portal/
COPY apps/business-hub/package.json apps/business-hub/
COPY packages packages
RUN npm ci
COPY . .
ENV SESSION_SECRET=build-time-placeholder-build-time-placeholder-0 OIDC_ISSUER_URL=https://placeholder.invalid OIDC_WEB_CLIENT_ID=x OIDC_WEB_CLIENT_SECRET=x NODE_ENV=production
RUN npm run build -w @dbl/partner-portal
WORKDIR /repo/apps/partner-portal
EXPOSE 3002
CMD ["sh", "-c", "npx next start -p ${PORT:-3002}"]
