#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bun_bin="${BUN_BIN:-bun}"
service_name="${HAPI_SERVICE_NAME:-hapi-hub.service}"
runner_service_name="${HAPI_RUNNER_SERVICE_NAME:-hapi-runner.service}"
install_path="${HAPI_INSTALL_PATH:-${HOME}/.local/lib/hapi-custom/current/hapi}"
staged_path="${install_path}.new"
previous_path="${install_path}.previous"
systemd_user_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
runner_dropin_dir="${systemd_user_dir}/${runner_service_name}.d"
runner_dropin_path="${runner_dropin_dir}/20-hapi-custom-cli.conf"
runner_dropin_staged_path=""

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
    if [[ -n "${runner_dropin_staged_path}" ]]; then
        rm -f -- "${runner_dropin_staged_path}"
    fi
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

# The runner can itself use the custom executable while still spawning new
# sessions through an older npm launcher via HAPI_CLI_EXECUTABLE. Pin child
# launches to the same stable custom binary path that this script installs.
if systemctl --user cat "${runner_service_name}" >/dev/null 2>&1; then
    install -d -m 700 "${runner_dropin_dir}"
    runner_dropin_staged_path="$(mktemp "${runner_dropin_path}.XXXXXX")"
    printf '[Service]\nEnvironment="HAPI_CLI_EXECUTABLE=%s"\n' "${install_path}" > "${runner_dropin_staged_path}"
    chmod 600 "${runner_dropin_staged_path}"
    mv -f -- "${runner_dropin_staged_path}" "${runner_dropin_path}"
    runner_dropin_staged_path=""
    systemctl --user daemon-reload
fi

if ! systemctl --user restart "${service_name}" || ! systemctl --user is-active --quiet "${service_name}"; then
    echo "Hub failed to start; restoring the previous binary." >&2
    if [[ -f "${previous_path}" ]]; then
        mv -f -- "${previous_path}" "${install_path}"
        systemctl --user restart "${service_name}"
    fi
    exit 1
fi

if systemctl --user is-active --quiet "${runner_service_name}"; then
    runner_kill_mode="$(systemctl --user show "${runner_service_name}" --property KillMode --value)"
    if [[ "${runner_kill_mode}" == "process" ]]; then
        systemctl --user restart "${runner_service_name}"
    else
        echo "Updated ${runner_service_name} for future custom CLI launches." >&2
        echo "Restart it when active sessions are idle; KillMode=${runner_kill_mode} may stop child sessions." >&2
    fi
fi

echo "Deployed ${install_path} and restarted ${service_name}."
