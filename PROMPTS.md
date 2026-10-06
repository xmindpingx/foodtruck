# Aider playbook for this site (local models: gemma4:12b plans, qwen2.5-coder:7b edits)

Small local models do best with: one task per message, the exact file named, the exact
function/element named, and a definition of done. Everything in CONVENTIONS.md and
ARCHITECTURE.md is already in the chat — don't paste it again.

## Workflow (every task)

```
./start_aider.sh                      # pre-warms both models, runs the smoke test
/add js/shop.js                       # add ONLY the file(s) the task touches (context is 24k)
<task prompt from below>              # architect shows a plan → y applies it, n = reply with fixes
/test                                 # smoke test; paste failures back if any
/diff                                 # review; /undo if wrong
exit                                  # then: pm2 restart foodtruck-site
```
Rules of thumb: `/add` at most 2 files at once; `/drop` when switching tasks; `/clear` chat
history if answers get vague (context pressure); `/tokens` shows what is eating context.

## Prompt templates

### Change a price / menu copy (no code)
Edit `menu.json` directly or use /admin → Menu. Don't use aider for data.

### Front-end UI change
```
In js/shop.js only. In renderCart(), after the Total row, show a line "Est. ready in 15 min"
(class "muted") when the cart has 1+ items; hide it when empty. Escape nothing new (static
text). Done when: node --check passes and the line toggles with the cart.
```

### CSS / mobile layout
```
In css/site.css only. In the @media(max-width:640px) block make nav buttons 44px tall for
touch. Do not change desktop rules. Done when the phone layout still has no horizontal scroll.
```

### 3D / truck visuals
```
In js/truck.js only, inside buildTruck(). Add a second string of 4 warm point lights under
the awning (reuse the loop that places the existing light panels; same positions, y -.30,
intensity 0.8, distance 3). No new imports. Done when node --check js/truck.js passes.
```
(For camera/lighting/sky changes use js/scene.js instead; for both, add both files.)

### Server / API change
```
In server.py only. Add GET /api/health returning {"ok": true, "orders": <count of orders with
status new or cooking>} with no auth. Put it in do_GET before the /api/admin/ block. Keep
static_allowed() and PUBLIC_SETTINGS unchanged. Done when /test passes and
curl 127.0.0.1:8095/api/health prints the JSON.
```

### Admin page
```
In admin.html only. In loadOrders(), after rendering, set the Orders tab button text to
"Orders (N)" where N = open orders (status not done/cancelled). Use textContent, not
innerHTML. Done when node has no syntax complaints and the count updates every poll.
```

### Bug report
```
Bug: on iPhone the cart "View order" bar overlaps the last menu item. Expected: 12px gap.
Likely css/site.css #cartBar (sticky) — propose the smallest fix, no layout rewrite.
```

### Security review (read-only, no edits)
```
/ask Review server.py static_allowed() and the /api/admin/* auth. List any way to read
data/ or call an admin route without a token. Do not edit anything.
```

## Model notes (RX 6800, 16 GB)

- gemma4:12b @ 24k ctx (~9.7 GB) + qwen2.5-coder:7b @ 16k ctx (~5.6 GB) are both resident
  (~14.9 GB). Bigger contexts don't fit together; Ollama would swap models every turn.
- If ComfyUI / Open WebUI holds VRAM, turns get 3-5× slower. start_aider.sh asks ComfyUI to
  park its weights; close Open WebUI chats or `ollama stop <model>` for the rest.
- Faster, slightly weaker planning: `./start_aider.sh --model ollama_chat/gemma4:e4b`.
- Temperature is 0.2 (architect) / 0.1 (editor) in ~/.aider.model.settings.yml on purpose:
  edits must be deterministic SEARCH/REPLACE blocks.
- If the editor keeps failing to apply a block ("SearchReplaceNoExactMatch"), the file is too
  dense for it: reply `n`, then say "edit only lines N-M of <file>" or split the task.
