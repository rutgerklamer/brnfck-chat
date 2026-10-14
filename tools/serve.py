#!/usr/bin/env python3
"""Serves site/ like `python -m http.server`, and also sends part of a file (HTTP Range requests).

    python tools/serve.py        http://localhost:8766/
    python tools/serve.py 9000   another port
"""
import os
import re
import sys
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):
        self.range = None
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not header or not os.path.isfile(path):
            return super().send_head()
        m = RANGE.match(header.strip())
        size = os.path.getsize(path)
        if not m or (m.group(1) == "" and m.group(2) == ""):
            return super().send_head()
        if m.group(1) == "":                       # the last N bytes
            first, last = max(0, size - int(m.group(2))), size - 1
        else:
            first = int(m.group(1))
            last = min(size - 1, int(m.group(2))) if m.group(2) else size - 1
        if first >= size or first > last:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(first)
        self.range = (first, last)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (first, last, size))
        self.send_header("Content-Length", str(last - first + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        if not getattr(self, "range", None):
            return super().copyfile(source, outputfile)
        left = self.range[1] - self.range[0] + 1
        while left > 0:
            piece = source.read(min(65536, left))
            if not piece:
                break
            outputfile.write(piece)
            left -= len(piece)

    def end_headers(self):
        if not getattr(self, "range", None):
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        # a missing page gets the site's own 404.html
        page = os.path.join(ROOT, "404.html")
        if code != HTTPStatus.NOT_FOUND or not os.path.isfile(page):
            return super().send_error(code, message, explain)
        with open(page, "rb") as f:
            body = f.read()
        self.range = None
        self.send_response(HTTPStatus.NOT_FOUND)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, fmt, *args):             # quiet: only errors
        if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=ROOT))
    print("Serving %s at http://localhost:%d/  (with byte ranges; Ctrl+C stops)" % (ROOT, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
