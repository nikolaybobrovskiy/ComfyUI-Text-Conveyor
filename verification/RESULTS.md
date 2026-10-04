# Verification results

Installed pack: `I:/progs/comfyui/installs/ComfyUI/ComfyUI/custom_nodes/ComfyUI-Text-Conveyor`

## Tests-first tracer bullets

Each slice was run red before its implementation, then run green:

1. Python whole-file text + metadata: missing `__init__.py` -> deterministic prompt/name/stem/index selector.
2. Python invalid JSON/index/state: 4 failed assertions and 5 index/type errors -> explicit user-facing validation (including negative/bool/float/out-of-range index).
3. JS strict UTF-8/BOM/duplicate names: missing helper module -> whole-file browser decoding.
4. JS file-count/size caps: missing expected rejection -> limits applied before reads.
5. JS graph/list snapshot queueing: missing BatchRunner export -> copied graph and independent per-file payloads.
6. JS stop/busy/fail-fast: missing expected concurrent-run rejection -> guarded runner, acknowledgements, stop and truthful error count.
7. UI picker/drop/selection/preview/remove/clear/persistence/Run All: missing UI module -> real controls wired to serializable widgets.
8. Python caps/BOM and safe no-model sink: BOM assertion failure / missing sink class -> server limits and safe exclusive-write example node.
9. Frontend registration: missing extension entrypoint -> class-specific, idempotent attachment.
10. Stop during async snapshot regression: queued count `1 !== 0` -> cancellation flag shared across preparation and submission.

## Final automated suites

- Actual ComfyUI interpreter: `I:/progs/comfyui/installs/ComfyUI/ComfyUI/.venv/Scripts/python.exe`.
- Python `unittest`: **4 tests passed** (with parametrized invalid-input/limit checks).
- Node `node --test tests/*.test.mjs`: **7 tests passed**, 0 failed.
- Execution transcripts: `python-tests.txt`, `javascript-tests.txt` in this directory.

## Actual frontend + execution verification

Disposable server: ComfyUI 0.38.2, frontend 1.53.6, localhost port 8197, CPU-only, API/model nodes disabled, all other custom nodes excluded. Base/output/user directories were separate scratch directories, not the Desktop instance's paths.

Fresh headless Chrome/Playwright exercised:

- Actual multiple-file picker and drag/drop.
- Unicode, BOM removal, CRLF preservation, duplicate names and empty text.
- Visible checkbox selection, remove/clear and full multiline preview.
- Saved graph serialization/reload, preserving prompt text and preview index.
- Actual Run All API submission, ComfyUI history success, and exact UTF-8 output files.
- Three distinct prompts, three successful history jobs, indices 0/1/2; no frontend page errors.
- Per-job workflow metadata index matched its execution input.

See `browser-report.json` for prompt IDs/output paths and `browser.png` for the inspected real frontend. The latest successful run used an explicit in-memory database and saved `prompt_0000_0003.txt`, `prompt_0001_0003.txt`, and `prompt_0002_0003.txt` beneath the scratch verification output folder. The original source-root database remained byte-identical across this final launch.

No inference/models were run. The existing Desktop server was not restarted or sent verification prompts. It was initially reachable at port 8188 but later became unreachable independently of this task; activation in that instance still needs a user-controlled backend start/restart and frontend refresh.

## Encountered / resolved

- Isolation pitfall found in ComfyUI startup: using only `--base-directory` triggered legacy database relocation, renaming the source-root `user/comfyui.db` to `.bak`. The verification process was stopped, that rename was reversed without overwriting any file, and restored bytes were verified by SHA-256 (`f799e61421fc3e60faff03b0fb575adec2ece99f44e5a8b62b751c8f0e1d988d`). Future verification launches must pass `--database-url sqlite:///:memory:` (or an explicit scratch database URL) to prevent this ComfyUI migration behavior.
- Sibling `standalone-env/python.exe` did not contain torch: discovered and used the source-root `.venv` instead.
- Browser helper could not copy the locked user Chrome profile: used a clean Playwright browser without closing any user tabs.
- Loading workflow before frontend canvas initialization failed (`getCanvas: canvas is null`): verification waits for the actual initialized canvas/graph before loading.
