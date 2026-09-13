ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

FROM ${NODE_IMAGE} AS builder
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache curl tini

WORKDIR /srv

COPY --from=builder --chown=node:node /build/public ./public
COPY --from=builder --chown=node:node /build/.next/standalone ./
COPY --from=builder --chown=node:node /build/.next/static ./.next/static

USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
    CMD ["curl", "-fsS", "http://localhost:3001/"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
