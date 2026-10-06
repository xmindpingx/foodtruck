#!/bin/bash
# Start aider for the El Otro Lado site (/home/dad/www/foodtruck) with the local Ollama models,
# tuned for this box: AMD RX 6800 (16 GB VRAM), 15 GB RAM, 8 cores.
#   ./start_aider.sh                                   # normal (architect gemma4:12b + editor qwen2.5-coder:7b)
#   ./start_aider.sh --model ollama_chat/gemma4:e4b    # smaller/faster architect
#   ./start_aider.sh --no-architect                    # single model
#   ./start_aider.sh --message "..."                   # one task, then exit
#
# Steps: activate venvLM → sanity checks → ask ComfyUI to park its FLUX weights in RAM (same
# GPU) → pre-load editor then architect so both stay resident → run aider → unload on exit →
# on exit, always print whether pm2 restart foodtruck-site is needed (see cleanup() below).
set -uo pipefail

PROJECT=/home/dad/www/foodtruck
VENV=/home/dad/ai-stacks/stacks/venvLM
OLLAMA=http://127.0.0.1:11434
COMFY=http://127.0.0.1:8188
ARCHITECT=ollama_chat/gemma4:12b
EDITOR_MODEL=ollama_chat/qwen2.5-coder:7b-instruct
# must match num_ctx in ~/.aider.model.settings.yml (a different num_ctx forces a reload)
ARCHITECT_CTX=24576
EDITOR_CTX=16384
KEEP_ALIVE=30m

for ((i=1; i<=$#; i++)); do
  if [ "${!i}" = "--model" ]; then j=$((i+1)); ARCHITECT="${!j}"; fi
done
A_NAME=${ARCHITECT#*/}; E_NAME=${EDITOR_MODEL#*/}

say()  { printf '\033[1;34m[start_aider]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[start_aider] WARNING:\033[0m %s\n' "$*"; }
shout(){ printf '\033[1;41;37m[start_aider] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[start_aider] ERROR:\033[0m %s\n' "$*"; exit 1; }

cd "$PROJECT" || die "cannot cd to $PROJECT"
[ -f "$VENV/bin/activate" ] || die "venv not found at $VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
export OLLAMA_API_BASE="$OLLAMA"

# ---- sanity checks ---------------------------------------------------------------------
python3 -c "import aider" 2>/dev/null || die "venv is missing aider (pip install -U aider-chat)"
command -v node >/dev/null || warn "node not found: the JS lint (node --check) will be skipped"
curl -sf --max-time 5 "$OLLAMA/api/version" >/dev/null || die "Ollama is not reachable at $OLLAMA"
for m in "$A_NAME" "$E_NAME"; do
  ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$m" || die "model $m is not pulled (ollama pull $m)"
done
[ -d .git ] || die "$PROJECT is not a git repo (git init && git add -A && git commit)"
if [ -f .git/index.lock ]; then warn "removing stale .git/index.lock"; rm -f .git/index.lock; fi

# remember where we started so cleanup() can tell what aider actually changed this session
START_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

# ---- free the GPU: ComfyUI shares the RX 6800 and may still hold FLUX weights ------------
if curl -sf --max-time 3 "$COMFY/system_stats" >/dev/null 2>&1; then
  say "asking ComfyUI to park its models in RAM ..."
  curl -s --max-time 15 -X POST "$COMFY/free" -H 'Content-Type: application/json' \
    -d '{"unload_models":true,"free_memory":false}' >/dev/null || true
fi
if command -v rocm-smi >/dev/null 2>&1; then
  used=$(rocm-smi --showmeminfo vram 2>/dev/null | grep "Used" | grep -oE "[0-9]+$")
  if [ -n "$used" ] && [ "$used" -gt $((2200*1048576)) ]; then
    warn "$((used/1048576)) MiB VRAM already in use; both aider models need ~14.9 GB together."
    warn "Expect Ollama to swap them (slower) until that is freed (ComfyUI / Open WebUI?)."
  fi
fi

# ---- pre-warm both models so the first turn is fast and they stay resident -------------
load() { curl -s --max-time 180 "$OLLAMA/api/generate" \
  -d "{\"model\":\"$1\",\"options\":{\"num_ctx\":$2},\"keep_alive\":\"$KEEP_ALIVE\"}" >/dev/null; }
say "loading editor    $E_NAME (num_ctx $EDITOR_CTX) ..."; load "$E_NAME" "$EDITOR_CTX"
say "loading architect $A_NAME (num_ctx $ARCHITECT_CTX) ..."; load "$A_NAME" "$ARCHITECT_CTX"
resident=$(ollama ps 2>/dev/null | awk 'NR>1{print $1}' | tr '\n' ' ')
case "$resident" in
  *"$A_NAME"*"$E_NAME"*|*"$E_NAME"*"$A_NAME"*) say "both models resident on the GPU: $resident" ;;
  *) warn "only [$resident] is loaded; Ollama will reload between architect and editor turns." ;;
esac

cleanup() {
  say "unloading models to free VRAM ..."
  curl -s --max-time 30 "$OLLAMA/api/generate" -d "{\"model\":\"$A_NAME\",\"keep_alive\":0}" >/dev/null
  curl -s --max-time 30 "$OLLAMA/api/generate" -d "{\"model\":\"$E_NAME\",\"keep_alive\":0}" >/dev/null

  # ---- always tell the human whether the live site needs a restart, regardless of whether
  # aider itself remembered to mention it in chat. Runs on every exit: normal quit, ctrl-c,
  # --message one-shot, or a crash.
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

say "smoke test before we start ..."
bash tests/smoke.sh >/dev/null 2>&1 && say "smoke test: PASS" || warn "smoke test FAILED — run: bash tests/smoke.sh"

say "starting aider in $PROJECT   (/test runs the smoke test; after edits: pm2 restart foodtruck-site)"
aider "$@"
