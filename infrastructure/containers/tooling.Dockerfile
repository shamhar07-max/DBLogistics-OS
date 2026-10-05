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
ENV NODE_ENV=production
CMD ["npx", "tsx", "scripts/railway-bootstrap.ts"]
