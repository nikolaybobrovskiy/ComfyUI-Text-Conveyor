# Export-boundary investigation after 196b67d

## Outcome

The remaining user's error is **not reproduced by Proxy properties alone** on the installed ComfyUI 0.39.2 / frontend 1.53.10. A fresh headless Chrome profile and disposable CPU-only server on 127.0.0.1:8197 exercised the actual `app.graphToPrompt()` with:

- ordinary properties;
- nested Proxy `properties.ue_properties.widget_ue_connectable`;
- a Proxy around the entire `node.properties` object.

All exports succeeded. The exported workflow retained the nested values, and the actual BatchRunner produced 60 independent payloads in an in-memory collector. This is not 60 server acknowledgements: **zero HTTP prompt submissions and zero inference** occurred.

The installed frontend bundle `assets/settingStore-CbkuaYBI.js` includes `safeCloneExtensionValue`, which catches DataCloneError and JSON-serializes extension values. Current ExecutableNodeDTO construction does not clone node properties. Installed cg-use-everywhere wraps graphToPrompt, but its JS source contains no structuredClone call. This does not establish behavior on the affected remote RunPod, whose frontend version, extensions and cached JS are unknown.

## Diagnostic change (not a speculative workaround)

`web/conveyor_ui.mjs` logs the original exception object, stage, node ID, acknowledged count and revision `196b67d-export-diagnostics-1`. Failure status displays stage/revision and directs the user to the full browser-console stack. No prompt/file/graph contents are logged. No global clone override, JSON fallback over an unknown failing export, reference sanitization, export-hook bypass or automatic retry was introduced.

A test-only onSerialize hook calling native `structuredClone` on the nested Proxy reproduces the exact error at the actual export boundary. This proves diagnostics, **not that an installed extension is responsible**. Captured call path:

```
DataCloneError: Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.
ComfyNode.hook [as onSerialize]
runExtensionSerializeHook
ComfyNode.serializeFromStoreState
serialiseStoredNodes
LGraph.asSerialisable
LGraph.serialize
graphToPrompt
```

The browser regression confirms the original native stack is logged, graph-export stage/revision appear, controls recover, and export is attempted once with no enqueue/retry.

## Verification

- New diagnostic unit test was red (expected one console log, got zero), then green.
- `node --test tests/core.test.mjs tests/ui.test.mjs`: 12 passed.
- `python -m unittest discover -s tests -v`: 4 passed.
- `tests/browser_export_boundary.mjs`: actual frontend Proxy exports, 60 collector payloads, injected native export failure diagnostics all passed; zero /prompt requests.
- `git diff --check`: passed.

## Re-running safely

Use a disposable base directory containing a copy of only this custom-node pack, with pre-created user/output/temp directories. Launch the installed ComfyUI interpreter with:

```
main.py --cpu --listen 127.0.0.1 --port 8197 --base-directory <scratch-base> --user-directory <scratch-base>/user --output-directory <scratch-base>/output --temp-directory <scratch-base>/temp --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI-Text-Conveyor --disable-api-nodes --disable-auto-launch --database-url sqlite:///:memory:
```

Do not omit the explicit scratch/in-memory database. `--disable-api-nodes` currently warns that it is deprecated but is accepted by this installation.

Install Playwright in scratch, then run from this repository (bash):

```
PLAYWRIGHT_PATH=<scratch>/node_modules/playwright/index.mjs node tests/browser_export_boundary.mjs
```

The test refuses any port except 8197 and intercepts/aborts every /prompt request. It loads only the no-model example into its own browser context; it never operates on the live user canvas. It waits for canvas + extension + registered node type rather than existing nodes (a clean first launch can have an empty graph).

## What is still needed

Deploy/reload the diagnostic frontend on the affected instance, then capture the `[Text Conveyor] Run All failed` console stack, stage, revision, and actual frontend version. Missing revision suggests old cached/unupdated code; a graph-export stack identifies the upstream serializer/hook. Evidence is insufficient for a safe property sanitization fix at present. Live port 8188 was not restarted and its user graph was not accessed or modified. No commit/push was performed.
