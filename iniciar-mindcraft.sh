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

echo "========================================"
echo "     Mindcraft — escolha a IA do Andy"
echo "========================================"
echo "1) MiMo 2.6 Flash → Groq (recomendado para o teste atual)"
echo "2) Groq Qwen → MiMo"
echo "3) Somente MiMo 2.6 Flash"
echo "4) Somente Groq Qwen 3.8 27B"
echo "5) Somente NVIDIA DeepSeek V4.1 Flash"
echo "6) Somente Ollama Qwen3 1.7B (local)"
echo "7) Ollama Andy 4 Micro Q8 (local, especializado e leve)"
echo "8) OpenAI — escolher modelo e esforço"
echo "9) Automático completo"
echo "0) Cancelar"
echo
if [[ -n "${MINDCRAFT_PRESET_CHOICE:-}" ]]; then
    provider_choice="$MINDCRAFT_PRESET_CHOICE"
else
    read -r -p "Opção [1]: " provider_choice
    provider_choice="${provider_choice:-1}"
fi

preset=""
selection_label=""
case "$provider_choice" in
    1) preset="mimo-groq"; selection_label="MiMo → Groq" ;;
    2) preset="groq-mimo"; selection_label="Groq → MiMo" ;;
    3) preset="mimo"; selection_label="somente MiMo" ;;
    4) preset="groq"; selection_label="somente Groq" ;;
    5) preset="nvidia"; selection_label="somente NVIDIA" ;;
    6) preset="ollama"; selection_label="somente Ollama local" ;;
    7) preset="andy4"; selection_label="Ollama Andy 4 Micro Q8 local" ;;
    8) preset="openai" ;;
    9) preset="automatic"; selection_label="automático completo" ;;
    0) exit 0 ;;
    *) echo "Opção inválida."; read -r -p "Pressione Enter para fechar..." _ || true; exit 1 ;;
esac

profile_args=("$preset")
if [[ "$preset" == "openai" ]]; then
    echo
    echo "Consultando modelos disponíveis na sua chave OpenAI..."
    openai_lines="$(node ./scripts/launcher-profile.js list-openai 2>/dev/null || true)"
    if [[ -z "$openai_lines" ]]; then
        echo "Não consegui consultar os modelos da chave OpenAI."
        read -r -p "Pressione Enter para fechar..." _ || true
        exit 1
    fi
    model_ids=()
    model_labels=()
    while IFS='|' read -r model_id model_label; do
        [[ -n "$model_id" ]] || continue
        model_ids+=("$model_id")
        model_labels+=("$model_label")
    done <<< "$openai_lines"
    for index in "${!model_ids[@]}"; do
        printf '%d) %s\n' "$((index + 1))" "${model_labels[$index]}"
    done
    echo
    read -r -p "Modelo [1]: " model_choice
    model_choice="${model_choice:-1}"
    if [[ ! "$model_choice" =~ ^[0-9]+$ ]] || (( model_choice < 1 || model_choice > ${#model_ids[@]} )); then
        echo "Modelo inválido."
        read -r -p "Pressione Enter para fechar..." _ || true
        exit 1
    fi
    selected_model="${model_ids[$((model_choice - 1))]}"

    echo
    echo "1) low — mais rápido"
    echo "2) medium — equilibrado"
    echo "3) high — mais raciocínio"
    read -r -p "Esforço [1]: " effort_choice
    case "${effort_choice:-1}" in
        1) selected_effort="low" ;;
        2) selected_effort="medium" ;;
        3) selected_effort="high" ;;
        *) echo "Esforço inválido."; read -r -p "Pressione Enter para fechar..." _ || true; exit 1 ;;
    esac
    profile_args+=("$selected_model" "$selected_effort")
    selection_label="OpenAI $selected_model ($selected_effort)"
fi

PROFILE_PATH="$(node ./scripts/launcher-profile.js "${profile_args[@]}")"

echo "Minecraft LAN detectado na porta $LAN_PORT."
echo "Perfil escolhido: $selection_label"
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

profiles_json="$(node -e 'console.log(JSON.stringify([process.argv[1]]))' "$PROFILE_PATH")"
setsid env MINECRAFT_PORT="$LAN_PORT" PROFILES="$profiles_json" npm start &
child_pid=$!
if wait "$child_pid"; then
    exit_code=0
else
    exit_code=$?
fi
trap - EXIT
exit "$exit_code"
