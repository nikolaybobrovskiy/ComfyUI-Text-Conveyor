import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
import '../../scripts/domWidget.js';
import { attachUI } from './conveyor_ui.mjs';

app.registerExtension({
  name: 'Nous.TextConveyor',
  nodeCreated(node) {
    if (node.comfyClass !== 'TextConveyor' || node.__textConveyorAttached) return;
    node.__textConveyorAttached = true;
    const state = node.widgets.find(w => w.name === 'entries_json');
    if (state) { state.type = 'hidden'; state.computeSize = () => [0, -4]; }
    attachUI(node, {
      snapshot: () => app.graphToPrompt(),
      queue: data => api.queuePrompt(0, data),
    });
  },
});
