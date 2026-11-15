from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

class RepositoryBasePathHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        pathname = urlsplit(path).path
        prefix = "/today-weather"
        if pathname == prefix:
            pathname = "/"
        elif pathname.startswith(prefix + "/"):
            pathname = pathname[len(prefix):]
        return super().translate_path(pathname)

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 4173), RepositoryBasePathHandler).serve_forever()
