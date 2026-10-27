#!/bin/bash
# Start aider for the El Otro Lado site (/home/dad/www/foodtruck)
# tuned for AMD RX 6800 (16 GB VRAM), 15 GB RAM, 8 cores.
set -uo pipefail

PROJECT=/home/dad/www/foodtruck
VENV=/data/venvs/aider   
OLLAMA=http://127.0.0.1:11434
COMFY=http://127.0.0.1:8188

# Default Configuration
ARCHITECT=ollama_chat/huihui_ai/huihui-4:8b
EDITOR_MODEL=ollama_chat/qwen2.5-coder:7b-instruct
USE_ARCHITECT=false

ARCHITECT_CTX=16384
EDITOR_CTX=16384
KEEP_ALIVE=30m

# Intercept flags to calculate VRAM budget safely
for ((i=1; i<=$#; i++)); do
  case "${!i}" in
    --model) j=$((i+1)); ARCHITECT="${!j}" ;;
    --architect) USE_ARCHITECT=true ;;
  esac
done

A_NAME=${ARCHITECT#*/}
E_NAME=${EDITOR_MODEL#*/}
say()  { printf '\033[1;34m[start_aider]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[start_aider] WARNING:\033[0m %s\n' "$*"; }
shout(){ printf '\033[1;41;37m[start_aider] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[start_aider] ERROR:\033[0m %s\n' "$*"; exit 1; }

cd "$PROJECT" || die "cannot cd to $PROJECT"
[ -f "$VENV/bin/activate" ] || die "venv not found at $VENV"
source "$VENV/bin/activate"
export OLLAMA_API_BASE="$OLLAMA"

# ---- sanity checks ---------------------------------------------------------------------
python3 -c "import aider" 2>/dev/null || die "venv is missing aider (pip install -U aider-chat)"
curl -sf --max-time 5 "$OLLAMA/api/version" >/dev/null || die "Ollama is not reachable at $OLLAMA"

# Smarter check that ignores case and trailing tags
check_model() {
  local raw="$1"
  local search
  search=$(echo "$raw" | sed 's/:latest$//')
  if ! ollama list 2>/dev/null | awk '{print $1}' | grep -iq "^${search}"; then
    die "model $raw is not pulled"
  fi
}

check_model "$A_NAME"
if [ "$USE_ARCHITECT" = true ]; then
  check_model "$E_NAME"
fi

[ -d .git ] || die "$PROJECT is not a git repo"
if [ -f .git/index.lock ]; then warn "removing stale .git/index.lock"; rm -f .git/index.lock; fi

START_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

# ---- free the GPU ----------------------------------------------------------------------
if curl -sf --max-time 3 "$COMFY/system_stats" >/dev/null 2>&1; then
  say "asking ComfyUI to park its models in RAM ..."
  curl -s --max-time 15 -X POST "$COMFY/free" -H 'Content-Type: application/json' \
    -d '{"unload_models":true,"free_memory":false}' >/dev/null || true
fi

source /home/dad/bin/aider-gpu-guard.sh
_guard_models=("$A_NAME")
[ "$USE_ARCHITECT" = true ] && _guard_models+=("$E_NAME")
gpu_guard "$OLLAMA" "${COMFY:-}" "${_guard_models[@]}" || exit 1

# ---- pre-warm models -------------------------------------------------------------------
load() { curl -s --max-time 180 "$OLLAMA/api/generate" \
  -d "{\"model\":\"$1\",\"options\":{\"num_ctx\":$2},\"keep_alive\":\"$KEEP_ALIVE\"}" >/dev/null; }

if [ "$USE_ARCHITECT" = true ]; then
  say "loading editor    $E_NAME (num_ctx $EDITOR_CTX) ..."
  load "$E_NAME" "$EDITOR_CTX"
  say "loading architect $A_NAME (num_ctx $ARCHITECT_CTX) ..."
else
  say "loading solo model $A_NAME (num_ctx $ARCHITECT_CTX) ..."
fi
load "$A_NAME" "$ARCHITECT_CTX"

resident=$(ollama ps 2>/dev/null | awk 'NR>1{print $1}' | tr '\n' ' ')
say "Resident on GPU: $resident"

cleanup() {
  say "unloading models to free VRAM ..."
  curl -s --max-time 30 "$OLLAMA/api/generate" -d "{\"model\":\"$A_NAME\",\"keep_alive\":0}" >/dev/null
  if [ "$USE_ARCHITECT" = true ]; then
    curl -s --max-time 30 "$OLLAMA/api/generate" -d "{\"model\":\"$E_NAME\",\"keep_alive\":0}" >/dev/null
  fi

  local end_sha changed dirty
  end_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
  changed=""
  if [ -n "$START_SHA" ] && [ -n "$end_sha" ] && [ "$end_sha" != "$START_SHA" ]; then
    changed=$(git diff --name-only "$START_SHA" "$end_sha" -- . ':!tests' 2>/dev/null)
  fi
  dirty=$(git status --porcelain 2>/dev/null)

  if [ -n "$changed" ] || [ -n "$dirty" ]; then
    echo
    shout "RESTART NEEDED — files changed this session:"
    { [ -n "$changed" ] && echo "$changed"; [ -n "$dirty" ] && echo "$dirty" | awk '{print $2}'; } \
      | sort -u | sed 's/^/    /'
    shout "run:  pm2 restart foodtruck-site"
    [ -n "$dirty" ] && warn "some changes above are uncommitted — review with 'git diff' first."
  else
    say "no files changed this session — pm2 restart not needed."
  fi
}
trap cleanup EXIT

say "starting aider in $PROJECT"
aider --read /home/dad/AAAaiderstacks/PORTS.md "$@"
