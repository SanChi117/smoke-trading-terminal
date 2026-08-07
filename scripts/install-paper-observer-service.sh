#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/install-paper-observer-service.sh" >&2
  exit 1
fi

REPO_DIR="${SMOKE_REPO_DIR:-$(pwd)}"
SERVICE_NAME="smoke-paper-observer"
SERVICE_USER="${SMOKE_SERVICE_USER:-${SUDO_USER:-root}}"
NODE_BIN="${SMOKE_NODE_BIN:-$(command -v node || true)}"
ENV_FILE="${SMOKE_PAPER_ENV_FILE:-${REPO_DIR}/.env.paper-observer}"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ ! -f "${REPO_DIR}/scripts/paper-observer-server.mjs" ]]; then
  echo "paper-observer-server.mjs not found under ${REPO_DIR}" >&2
  exit 1
fi
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node.js executable not found" >&2
  exit 1
fi

mkdir -p "${REPO_DIR}/runtime/paper-observer"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${REPO_DIR}/runtime"

if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<'ENV'
PAPER_OBSERVER_PORT=8092
PAPER_SCAN_INTERVAL_MS=300000
PAPER_SCAN_CONCURRENCY=3
ENV
  chown "${SERVICE_USER}:${SERVICE_USER}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

cat > "${UNIT_FILE}" <<UNIT
[Unit]
Description=SMOKE Level Flow V5 Paper Observer
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${REPO_DIR}
Environment=NODE_ENV=production
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} --experimental-strip-types ${REPO_DIR}/scripts/paper-observer-server.mjs
Restart=always
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${REPO_DIR}/runtime

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

echo
echo "Paper observer installed in PAPER_ONLY mode."
echo "Health: curl http://127.0.0.1:8092/health"
echo "Status: curl http://127.0.0.1:8092/status"
