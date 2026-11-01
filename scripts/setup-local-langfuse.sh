#!/usr/bin/env bash
set -euo pipefail

readonly LANGFUSE_DIR="${LANGFUSE_DIR:-${HOME}/Downloads/langfuse}"
readonly LANGFUSE_REPOSITORY="https://github.com/langfuse/langfuse.git"
readonly CHASING_CONFIG_DIR="${HOME}/.config/chasing"
readonly CHASING_CONFIG_FILE="${CHASING_CONFIG_DIR}/config.json"

if [[ ! -d "${LANGFUSE_DIR}/.git" ]]; then
  git clone --depth=1 "${LANGFUSE_REPOSITORY}" "${LANGFUSE_DIR}"
fi

if [[ ! -f "${LANGFUSE_DIR}/.env" ]]; then
  umask 077
  postgres_password="$(openssl rand -hex 24)"
  clickhouse_password="$(openssl rand -hex 24)"
  redis_password="$(openssl rand -hex 24)"
  minio_password="$(openssl rand -hex 24)"
  public_key="lf_pk_$(openssl rand -hex 24)"
  secret_key="lf_sk_$(openssl rand -hex 32)"
  admin_password="$(openssl rand -hex 16)"

  {
    printf 'NEXTAUTH_URL=http://localhost:3000\n'
    printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
    printf 'SALT=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
    printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
    printf 'TELEMETRY_ENABLED=false\n'
    printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
    printf 'DATABASE_URL=postgresql://postgres:%s@postgres:5432/postgres\n' "${postgres_password}"
    printf 'CLICKHOUSE_PASSWORD=%s\n' "${clickhouse_password}"
    printf 'REDIS_AUTH=%s\n' "${redis_password}"
    printf 'MINIO_ROOT_USER=minio\n'
    printf 'MINIO_ROOT_PASSWORD=%s\n' "${minio_password}"
    printf 'LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minio\n'
    printf 'LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=%s\n' "${minio_password}"
    printf 'LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=minio\n'
    printf 'LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=%s\n' "${minio_password}"
    printf 'LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID=minio\n'
    printf 'LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY=%s\n' "${minio_password}"
    printf 'LANGFUSE_INIT_ORG_ID=chasing-local\n'
    printf 'LANGFUSE_INIT_ORG_NAME=Chasing-Local\n'
    printf 'LANGFUSE_INIT_PROJECT_ID=chasing\n'
    printf 'LANGFUSE_INIT_PROJECT_NAME=Chasing\n'
    printf 'LANGFUSE_INIT_PROJECT_PUBLIC_KEY=%s\n' "${public_key}"
    printf 'LANGFUSE_INIT_PROJECT_SECRET_KEY=%s\n' "${secret_key}"
    printf 'LANGFUSE_INIT_USER_EMAIL=chasing@local.test\n'
    printf 'LANGFUSE_INIT_USER_NAME=Chasing-Admin\n'
    printf 'LANGFUSE_INIT_USER_PASSWORD=%s\n' "${admin_password}"
  } > "${LANGFUSE_DIR}/.env"
fi

public_key="$(sed -n 's/^LANGFUSE_INIT_PROJECT_PUBLIC_KEY=//p' "${LANGFUSE_DIR}/.env")"
secret_key="$(sed -n 's/^LANGFUSE_INIT_PROJECT_SECRET_KEY=//p' "${LANGFUSE_DIR}/.env")"
if [[ -z "${public_key}" || -z "${secret_key}" ]]; then
  echo "Langfuse .env is missing headless project keys" >&2
  exit 1
fi

mkdir -p "${CHASING_CONFIG_DIR}"
umask 077
config_tmp="$(mktemp "${CHASING_CONFIG_DIR}/config.json.XXXXXX")"
CHASING_LANGFUSE_PUBLIC_KEY="${public_key}" \
CHASING_LANGFUSE_SECRET_KEY="${secret_key}" \
node --input-type=module - "${CHASING_CONFIG_FILE}" "${config_tmp}" <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const [, , configFile, configTmp] = process.argv;
let config = {};
try {
  config = JSON.parse(await readFile(configFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
config.langfuse = {
  enabled: true,
  baseUrl: "http://localhost:3000",
  publicKey: process.env.CHASING_LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.CHASING_LANGFUSE_SECRET_KEY,
};
await writeFile(configTmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
NODE
chmod 600 "${config_tmp}"
mv "${config_tmp}" "${CHASING_CONFIG_FILE}"

docker compose --project-directory "${LANGFUSE_DIR}" up -d

echo "Langfuse is configured for Chasing at http://localhost:3000"
echo "Admin email: chasing@local.test (password is stored in ${LANGFUSE_DIR}/.env)"
