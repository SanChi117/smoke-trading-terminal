from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from backend.server import Handler


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def get(self, path: str) -> dict:
        with urllib.request.urlopen(self.base + path, timeout=3) as response:  # noqa: S310 - local test server
            return json.loads(response.read().decode("utf-8"))

    def test_health_has_no_live_execution(self) -> None:
        payload = self.get("/api/health")
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["live_execution"])
        self.assertEqual(payload["mode"], "paper_only_no_orders")

    def test_snapshot_keeps_live_blocked(self) -> None:
        payload = self.get("/api/snapshot")
        self.assertFalse(payload["live_execution"])


if __name__ == "__main__":
    unittest.main()
