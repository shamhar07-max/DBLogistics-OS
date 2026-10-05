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
RUN npm run build -w @dbl/api
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /repo/apps/api/dist ./dist
COPY --from=base /repo/node_modules ./node_modules
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
