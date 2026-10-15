# PAPER-only migration candidate image. Build from repository ROOT:
# docker build -f deployment/portable-paper/Dockerfile .
# DO NOT deploy before testing destination Binance USD-M egress and recovery.
FROM node:22.16.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /srv

COPY deployment/portable-paper/package.json ./deployment/portable-paper/package.json
COPY deployment/portable-paper/package-lock.json ./deployment/portable-paper/package-lock.json
RUN npm ci --prefix ./deployment/portable-paper \
      --omit=dev --ignore-scripts --no-audit --no-fund

COPY core/paper/ ./core/paper/
COPY core/market/ ./core/market/
COPY app/lib/level/ ./app/lib/level/
COPY deployment/portable-paper/server.mjs ./deployment/portable-paper/server.mjs
COPY deployment/portable-paper/market-egress-probe.mjs ./deployment/portable-paper/market-egress-probe.mjs
COPY deployment/portable-paper/worker-once.mjs ./deployment/portable-paper/worker-once.mjs

USER node
EXPOSE 8097
CMD ["node", "--experimental-strip-types", "deployment/portable-paper/server.mjs"]
