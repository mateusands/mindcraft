#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_DIR="$(dirname "$SCRIPT_PATH")"

# A double-click launches a dedicated terminal. The environment marker avoids
# recursively opening terminals when the script starts inside Konsole.
if [[ "${MINDCRAFT_TERMINAL:-0}" != "1" ]]; then
    if command -v konsole >/dev/null 2>&1; then
        exec konsole -e env MINDCRAFT_TERMINAL=1 "$SCRIPT_PATH"
    elif command -v gnome-terminal >/dev/null 2>&1; then
        exec gnome-terminal -- env MINDCRAFT_TERMINAL=1 "$SCRIPT_PATH"
    elif command -v x-terminal-emulator >/dev/null 2>&1; then
        exec x-terminal-emulator -e env MINDCRAFT_TERMINAL=1 "$SCRIPT_PATH"
    fi
fi

cd "$REPO_DIR"

for candidate_pid in $(pgrep -f 'node main\.js' 2>/dev/null || true); do
    candidate_cwd="$(readlink -f "/proc/$candidate_pid/cwd" 2>/dev/null || true)"
    if [[ "$candidate_cwd" == "$REPO_DIR" ]]; then
        echo "O Mindcraft já está aberto (PID $candidate_pid)."
        echo "Feche o terminal da instância atual antes de abrir outra."
        read -r -p "Pressione Enter para fechar..." _ || true
        exit 1
    fi
done

LAN_PORT=""
while IFS= read -r minecraft_pid; do
    [[ -n "$minecraft_pid" ]] || continue
    endpoint="$(ss -H -ltnp 2>/dev/null | awk -v pid="$minecraft_pid" 'index($0, "pid=" pid ",") { print $4; exit }')"
    if [[ -n "$endpoint" ]]; then
        LAN_PORT="${endpoint##*:}"
        break
    fi
done < <(pgrep -f 'minecraft-[^ ]+-client\.jar' 2>/dev/null || true)

if [[ ! "$LAN_PORT" =~ ^[0-9]+$ ]]; then
    echo "Não encontrei um mundo Minecraft aberto para LAN."
    echo "Abra o mundo, escolha 'Abrir para LAN' e execute este arquivo novamente."
    read -r -p "Pressione Enter para fechar..." _ || true
    exit 1
fi

RUNTIME_BIN="$REPO_DIR/.runtime/node-v22.23.3-linux-x64/bin"
if [[ -x "$RUNTIME_BIN/node" ]]; then
    export PATH="$RUNTIME_BIN:$PATH"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js/npm não foram encontrados."
    read -r -p "Pressione Enter para fechar..." _ || true
    exit 1
fi

echo "Minecraft LAN detectado na porta $LAN_PORT."
echo "Iniciando Mindcraft. Feche este terminal para desligar o bot."
echo

child_pid=""
cleanup() {
    if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
        kill -TERM -- "-$child_pid" 2>/dev/null || true
        wait "$child_pid" 2>/dev/null || true
    fi
}
trap cleanup HUP INT TERM EXIT

setsid env MINECRAFT_PORT="$LAN_PORT" npm start &
child_pid=$!
if wait "$child_pid"; then
    exit_code=0
else
    exit_code=$?
fi
trap - EXIT
exit "$exit_code"
