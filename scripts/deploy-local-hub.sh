#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bun_bin="${BUN_BIN:-bun}"
service_name="${HAPI_SERVICE_NAME:-hapi-hub.service}"
install_path="${HAPI_INSTALL_PATH:-${HOME}/.local/lib/hapi-custom/current/hapi}"
staged_path="${install_path}.new"
previous_path="${install_path}.previous"

case "$(uname -m)" in
    x86_64) build_target="bun-linux-x64-baseline" ;;
    aarch64 | arm64) build_target="bun-linux-arm64" ;;
    *)
        echo "Unsupported Linux architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

build_path="${repo_root}/cli/dist-exe/${build_target}/hapi"

cleanup() {
    rm -f -- "${staged_path}"
}
trap cleanup EXIT

if ! command -v "${bun_bin}" >/dev/null 2>&1; then
    echo "Bun was not found. Install Bun or set BUN_BIN to its executable path." >&2
    exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl is required to deploy the local hub service." >&2
    exit 1
fi

service_exec="$(systemctl --user show "${service_name}" --property ExecStart --value)"
if [[ "${service_exec}" != *"${install_path}"* ]]; then
    echo "${service_name} does not use ${install_path}." >&2
    echo "Set HAPI_INSTALL_PATH to the service binary path or update ExecStart first." >&2
    exit 1
fi

cd "${repo_root}"

"${bun_bin}" install --frozen-lockfile

if [[ "${HAPI_SKIP_CHECKS:-0}" != "1" ]]; then
    "${bun_bin}" run typecheck:hub
    "${bun_bin}" run test:hub
fi

"${bun_bin}" run download:tunwg
"${bun_bin}" run build:web
"${bun_bin}" run --cwd hub generate:embedded-web-assets
"${bun_bin}" run --cwd cli build:exe:allinone --target "${build_target}"

install -d "$(dirname -- "${install_path}")"
install -m 755 "${build_path}" "${staged_path}"

if [[ -f "${install_path}" ]]; then
    cp -p -- "${install_path}" "${previous_path}"
fi

mv -f -- "${staged_path}" "${install_path}"

if ! systemctl --user restart "${service_name}" || ! systemctl --user is-active --quiet "${service_name}"; then
    echo "Hub failed to start; restoring the previous binary." >&2
    if [[ -f "${previous_path}" ]]; then
        mv -f -- "${previous_path}" "${install_path}"
        systemctl --user restart "${service_name}"
    fi
    exit 1
fi

echo "Deployed ${install_path} and restarted ${service_name}."
