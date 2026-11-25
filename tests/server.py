from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading

ROOT = Path(__file__).resolve().parents[1]


def serve(baseline=None):
    class Files(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            allowed = {
                "/baseline/legacy.js": "dist/aurora-glass.global.js",
                "/baseline/style.css": "aurora.css",
            }
            if baseline and path in allowed:
                return str(Path(baseline) / allowed[path])
            return super().translate_path(path)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Files, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, "http://127.0.0.1:" + str(server.server_port)
