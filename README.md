# Text Conveyor

Standalone ComfyUI custom node. No pip dependencies, model downloads, filesystem-read endpoints, or dependency on Image Conveyor.

## Install / activation

Place this folder in `ComfyUI/custom_nodes/ComfyUI-Text-Conveyor`.
**A backend restart is required to register the Python nodes**, then refresh/reopen the frontend. Installation does not restart an existing ComfyUI/Comfy Desktop server. Save your work and restart manually when convenient.

Add **Text Conveyor** from the **Text Conveyor** category. Outputs:

| Output | Type | Meaning |
| --- | --- | --- |
| prompt | STRING | Entire selected file, including line breaks; UTF-8 BOM removed |
| filename | STRING | Original basename, including extension |
| stem | STRING | Basename without its final extension |
| index | INT | Zero-based position in the current file list |

## Usage

1. Click **Add text files** to select multiple files, or drop files directly onto the node.
2. Files append in the order supplied by the browser. Duplicate filenames stay as separate entries; the displayed number distinguishes them. Empty files are valid empty prompts.
3. Checkboxes choose which files participate in **Run All**. Newly loaded files are selected. **Select all**, **Select none**, **Remove selected**, and **Clear** manage the list.
4. Click a filename to preview its full text and set the ordinary `index` widget. Normal ComfyUI Run queues one workflow using that index.
5. Connect `prompt` to your text input (convert a text widget into an input if necessary), and connect filename/stem/index to naming helpers as desired.
6. **Run All** queues one complete workflow per checked file, in list order. It does not split paragraphs/lines and does not send files to the server for reading.

The frontend reads strict UTF-8 (optional BOM); invalid UTF-8 rejects the whole add operation and keeps the existing list unchanged. Limits: 500 files, 1 MiB per file, 20 MiB combined text. Browser picker suggests `.txt`, `.md`, `.text`, and `.prompt`; valid UTF-8 files dropped onto the node are also accepted.

Prompt texts and selection are serialized into the saved workflow. The original local files do not need to remain available. **Workflow files and queued metadata contain the full prompt text**: do not share workflows containing private text unintentionally. There is no server-side arbitrary-path reader.

## Queue semantics / safety

- The selected list is copied before async graph export. The exported API graph and workflow metadata are deep-copied before submission. Only this node's text-list and index inputs are overridden per job; per-job workflow metadata contains the same inputs.
- Queue calls are sequentially awaited. No temporary mutation of the live node inputs is used to queue the batch. A second Run All on this node is blocked while preparing/queueing.
- Existing seeds and other graph inputs stay fixed at the exported snapshot; this is not ComfyUI's automatic seed-increment loop. Other Text Conveyor nodes in the graph keep their current selection/index. Use one batching source at a time.
- Progress reports **server-acknowledged queued jobs**, not inference/execution completion. Inspect ComfyUI's queue/history for execution results.
- Validation or transport errors stop further enqueueing. A partial-validation response can already have accepted the last job, and that acknowledgement is included in the count. There is no automatic retry. After a network failure, inspect the queue before retrying: a request may have reached the server without its response reaching the browser.
- **Stop enqueueing** stops future submissions, including cancellation while preparing the snapshot. An in-flight request can still be accepted. It never interrupts inference, deletes queue entries, or cancels somebody else's jobs.
- Queueing a graph with inference nodes will execute them normally. The included example has no inference nodes.

## No-model example

Load `examples/no_models.json`. It contains two sample prompts and connects Text Conveyor to **Text Conveyor Save Text (example)**. Press the node's Run All to write both results to:

`<ComfyUI output directory>/text_conveyor/prompt_<index>_<counter>.txt`

The sink uses a fixed safe output subdirectory, exclusive creation, and counter-based names. It never uses an incoming filename as a disk path and never overwrites an existing result. It is a small verification sink, not a general-purpose filename templating system.

## Tests

From this folder, with any recent Python and Node:

```sh
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

`tests/browser_verify.mjs` exercises the actual installed ComfyUI frontend, file picker, drag/drop, controls, serialization, API queue, history, and byte-for-byte saved output. Run it **only on a disposable isolated ComfyUI instance** with this extension installed. It refuses port 8188 and replaces the disposable browser canvas with the example. It requires Playwright and Chrome (or set `CHROME_PATH`). Optional environment variables: `TC_TEST_URL`, `PLAYWRIGHT_PATH` (absolute Playwright `index.mjs` path), `TC_REPORT`, `TC_SCREENSHOT`.

This install was verified with ComfyUI 0.38.2 / frontend 1.53.6 on an isolated CPU-only instance. See `verification/RESULTS.md` and `verification/browser-report.json`. No model inference was run and the existing Desktop server was not restarted.
