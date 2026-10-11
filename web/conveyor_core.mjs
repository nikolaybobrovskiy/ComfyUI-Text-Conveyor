export const MAX_FILES = 500;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * MAX_FILE_BYTES;
export async function readTextFiles(files) {
  files = Array.from(files);
  if (files.length > MAX_FILES) throw Error('Text Conveyor: maximum 500 files');
  if (files.some(f => f.size > MAX_FILE_BYTES)) throw Error('Text Conveyor: maximum 1 MiB per file');
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) throw Error('Text Conveyor: maximum 20 MiB total');
  const result = [];
  for (const file of files) {
    result.push({ name: file.name, text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) });
  }
  return result;
}

// Queue payloads are JSON, not structured-clone data. JSON serialization also
// unwraps reactive Proxies returned by the frontend without touching live state.
export const jsonSnapshot = value => JSON.parse(JSON.stringify(value));

export class BatchRunner {
  running = false;
  stopped = false;
  stop() { this.stopped = true; }
  async run(entries, indexes, snapshot, nodeId, queue, progress = () => {}) {
    if (this.running) throw Error('Text Conveyor: already running');
    this.running = true;
    this.stopped = false;
    let queued = 0;
    const selected = [...indexes];
    try {
      if (!selected.length) throw Error('Text Conveyor: select at least one file');
      if (selected.some(i => !Number.isInteger(i) || i < 0 || i >= entries.length) || new Set(selected).size !== selected.length) throw Error('Text Conveyor: invalid selected index');
      const base = jsonSnapshot(snapshot);
      if (base.output[nodeId]?.class_type !== 'TextConveyor') throw Error('Text Conveyor: node missing or bypassed in workflow');
      const raw = JSON.stringify(entries);
      for (const index of selected) {
        if (this.stopped) break;
        const data = jsonSnapshot(base);
        data.output[nodeId].inputs.entries_json = raw;
        data.output[nodeId].inputs.index = index;
        const workflowNode = data.workflow.nodes.find(n => String(n.id) === String(nodeId));
        if (workflowNode) workflowNode.widgets_values = [raw, index];
        const response = await queue(data);
        if (!response?.prompt_id) throw Error('Text Conveyor: server returned no queue acknowledgement');
        queued++;
        progress({ queued, total: selected.length });
        if (response.node_errors && Object.keys(response.node_errors).length) throw Error('Text Conveyor: workflow validation errors (last job accepted but may be partial)');
      }
      return { queued, total: selected.length, stopped: this.stopped };
    } catch (cause) {
      const error = new Error(cause.message || String(cause), { cause });
      error.queued = queued;
      error.total = selected.length;
      throw error;
    } finally { this.running = false; }
  }
}
