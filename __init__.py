"""Standalone, filesystem-free Text Conveyor source node."""
import json
from pathlib import PurePosixPath


class TextConveyor:
    CATEGORY = "Text Conveyor"
    FUNCTION = "select"
    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("prompt", "filename", "stem", "index")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "entries_json": ("STRING", {"default": "[]", "multiline": True}),
            "index": ("INT", {"default": 0, "min": 0, "max": 499}),
        }}

    def select(self, entries_json, index):
        try:
            entries = json.loads(entries_json)
        except (ValueError, TypeError) as exc:
            raise ValueError("Text Conveyor: invalid entries JSON") from exc
        if not isinstance(entries, list) or not entries:
            raise ValueError("Text Conveyor: load at least one text file")
        if type(index) is not int or not 0 <= index < len(entries):
            raise ValueError("Text Conveyor: index is outside the file list")
        if len(entries) > 500:
            raise ValueError("Text Conveyor: maximum 500 files")
        total = 0
        for item in entries:
            if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                raise ValueError("Text Conveyor: every entry needs string text")
            name = item.get("name")
            if not isinstance(name, str) or not name or any(c in name for c in ('/', '\\', '\x00')) or name in ('.', '..'):
                raise ValueError("Text Conveyor: filenames must be basenames")
            size = len(item["text"].encode("utf-8"))
            if size > 1024 * 1024:
                raise ValueError("Text Conveyor: maximum 1 MiB per file")
            total += size
            if total > 20 * 1024 * 1024:
                raise ValueError("Text Conveyor: maximum 20 MiB total")
        entry = entries[index]
        name = entry["name"]
        text = entry["text"]
        if text.startswith('\ufeff'):
            text = text[1:]
        return text, name, PurePosixPath(name).stem, index


class TextConveyorSaveText:
    """Harmless no-model example sink; fixed output location, exclusive writes."""
    CATEGORY = "Text Conveyor"
    FUNCTION = "save"
    RETURN_TYPES = ()
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"forceInput": True}),
                             "filename": ("STRING", {"forceInput": True}),
                             "index": ("INT", {"forceInput": True})}}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float('nan')

    def save(self, text, filename, index):
        from pathlib import Path
        import folder_paths
        directory = Path(folder_paths.get_output_directory()) / 'text_conveyor'
        directory.mkdir(parents=True, exist_ok=True)
        # Never use supplied filename as a disk path (even when called outside Comfy).
        counter = 1
        while True:
            target = directory / f'prompt_{int(index):04d}_{counter:04d}.txt'
            try:
                with target.open('xb') as handle:
                    handle.write(text.encode('utf-8'))
                break
            except FileExistsError:
                counter += 1
        return {"ui": {"text": [str(target)]}}


NODE_CLASS_MAPPINGS = {"TextConveyor": TextConveyor, "TextConveyorSaveText": TextConveyorSaveText}
NODE_DISPLAY_NAME_MAPPINGS = {"TextConveyor": "Text Conveyor", "TextConveyorSaveText": "Text Conveyor Save Text (example)"}
WEB_DIRECTORY = "./web"
