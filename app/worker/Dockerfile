ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# node:22-alpine already ships a `node` user with UID/GID 1000. Reuse it.
RUN apk add --no-cache curl tini

WORKDIR /srv
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps && npm cache clean --force
COPY --chown=node:node --from=builder /build/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
    CMD ["curl", "-fsS", "http://localhost:3000/healthz"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
