# PAPER-only migration candidate image. Build from repository ROOT:
# docker build -f deployment/portable-paper/Dockerfile .
# DO NOT deploy before testing destination Binance USD-M egress and recovery.
FROM node:22.16.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /srv

COPY deployment/portable-paper/package.json ./deployment/portable-paper/package.json
RUN npm install --prefix ./deployment/portable-paper \
      --omit=dev --ignore-scripts --no-audit --no-fund

COPY core/paper/ ./core/paper/
COPY core/market/binance-usdm-egress.ts ./core/market/binance-usdm-egress.ts
COPY deployment/portable-paper/server.mjs ./deployment/portable-paper/server.mjs
COPY deployment/portable-paper/market-egress-probe.mjs ./deployment/portable-paper/market-egress-probe.mjs

USER node
EXPOSE 8097
CMD ["node", "--experimental-strip-types", "deployment/portable-paper/server.mjs"]
