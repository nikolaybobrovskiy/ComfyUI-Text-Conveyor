import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class TextNodeTests(unittest.TestCase):
    def test_entire_unicode_multiline_file_and_metadata(self):
        spec = importlib.util.spec_from_file_location('text_conveyor', ROOT / '__init__.py')
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        entries = [{'name': 'draft.猫.txt', 'text': 'one\r\nдва\n猫'}, {'name': 'draft.猫.txt', 'text': ''}]
        self.assertEqual(module.TextConveyor().select(json.dumps(entries), 0), ('one\r\nдва\n猫', 'draft.猫.txt', 'draft.猫', 0))
        self.assertEqual(module.TextConveyor().select(json.dumps(entries), 1), ('', 'draft.猫.txt', 'draft.猫', 1))

    def test_invalid_state_and_index_rejected(self):
        spec = importlib.util.spec_from_file_location('text_conveyor', ROOT / '__init__.py')
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        node = module.TextConveyor()
        for raw, index in [('oops', 0), ('{}', 0), ('[]', 0), ('[{"name":"a.txt","text":"x"}]', -1), ('[{"name":"a.txt","text":"x"}]', True), ('[{"name":"a.txt","text":"x"}]', 1), ('[{"name":"../a.txt","text":"x"}]', 0), ('[{"name":"a.txt","text":12}]', 0), ('[{"name":"a.txt","text":"x"}]', 0.5)]:
            with self.subTest(raw=raw, index=index):
                with self.assertRaisesRegex(ValueError, 'Text Conveyor'):
                    node.select(raw, index)

    def test_limits_and_bom(self):
        spec = importlib.util.spec_from_file_location('text_conveyor', ROOT / '__init__.py')
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        node = module.TextConveyor()
        self.assertEqual(node.select(json.dumps([{'name':'bom.txt','text':'\ufeffhello'}]), 0)[0], 'hello')
        for entries in [[{'name':'a.txt','text':'x'}] * 501, [{'name':'a.txt','text':'x' * (1048576+1)}], [{'name':'a.txt','text':'x' * 1048576}] * 21]:
            with self.assertRaisesRegex(ValueError,'Text Conveyor'):
                node.select(json.dumps(entries), 0)

    def test_safe_writer_never_uses_filename_as_path_and_preserves_text(self):
        import tempfile, sys, types
        spec = importlib.util.spec_from_file_location('text_conveyor', ROOT / '__init__.py')
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            previous = sys.modules.get('folder_paths')
            fake_folder_paths = types.ModuleType('folder_paths')
            setattr(fake_folder_paths, 'get_output_directory', lambda: tmp)
            sys.modules['folder_paths'] = fake_folder_paths
            try:
                writer = module.TextConveyorSaveText()
                a = writer.save('hello\r\n猫', '../../escape.txt', 0)
                b = writer.save('second', '../../escape.txt', 0)
                files = sorted(Path(tmp).rglob('*.txt'))
                self.assertEqual(len(files),2)
                self.assertEqual(files[0].read_bytes(), 'hello\r\n猫'.encode('utf-8'))
                self.assertNotEqual(a['ui']['text'], b['ui']['text'])
                self.assertFalse((Path(tmp).parent/'escape.txt').exists())
            finally:
                if previous is None: sys.modules.pop('folder_paths',None)
                else: sys.modules['folder_paths'] = previous

if __name__ == '__main__':
    unittest.main()
