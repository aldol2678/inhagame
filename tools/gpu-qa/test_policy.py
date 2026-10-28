"""Pure unit tests, no browser or GPU required: python -m unittest discover."""
import unittest
from policy import evaluate_probe, choose_route, is_trusted_local_url


class PolicyTests(unittest.TestCase):
    def test_webgpu_device_is_ready_not_scene_pass(self):
        r = evaluate_probe({'webgpu': {'adapter_created': True, 'device_created': True}})
        self.assertEqual(r['status'], 'READY_RENDER_QA')
        self.assertEqual(r['backend'], 'WEBGPU')
        self.assertEqual(r['render_qa'], 'NOT_RUN')

    def test_adapter_alone_not_ready(self):
        self.assertEqual(evaluate_probe({'webgpu': {'adapter_created': True}})['status'], 'BLOCKED_GPU')

    def test_webgl_context_without_pixel_check_not_ready(self):
        self.assertEqual(evaluate_probe({'webgl2': {'context_created': True, 'pixel_check': False}})['status'], 'BLOCKED_GPU')

    def test_webgl_pixel_check_ready_not_pass(self):
        r = evaluate_probe({'webgl2': {'context_created': True, 'pixel_check': True}})
        self.assertEqual((r['status'], r['backend'], r['render_qa']), ('READY_RENDER_QA', 'WEBGL2', 'NOT_RUN'))

    def test_missing_gpu_is_blocked_not_app_fail(self):
        r = choose_route({'webgl2': {}, 'webgpu': {}}, allow_software=False)
        self.assertEqual((r['status'], r['route']), ('BLOCKED_GPU', 'OFFLINE_QA_AND_EXTERNAL_REAL_GPU'))

    def test_software_attempt_requires_trust(self):
        p = {'webgl2': {}, 'webgpu': {}}
        self.assertEqual(choose_route(p, allow_software=True, trusted_local=True)['route'], 'TRY_SOFTWARE_WEBGL_THEN_OFFLINE')
        self.assertEqual(choose_route(p, allow_software=True, trusted_local=False)['route'], 'OFFLINE_QA_AND_EXTERNAL_REAL_GPU')

    def test_browser_launch_error(self):
        self.assertEqual(evaluate_probe({'browser_error': 'Error'})['status'], 'BLOCKED_BROWSER')

    def test_block_unsafe_remote(self):
        for url in ('https://example.com', 'http://localhost.evil.com', 'file:///tmp/a.html', 'http://user:pass@localhost', 'https://127.0.0.2'):
            self.assertFalse(is_trusted_local_url(url), url)
        for url in (None, 'http://127.0.0.1:4173/campus/', 'http://localhost:3000', 'http://[::1]:8000'):
            self.assertTrue(is_trusted_local_url(url), url)


if __name__ == '__main__':
    unittest.main()
