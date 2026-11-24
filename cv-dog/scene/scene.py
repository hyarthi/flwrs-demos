"""The demo's scene from its readable files, for the installer and the tests.

Python 3.8+, standard library only. A string value "@include:<file>" in
graph.json or scene.json is replaced by that file's text (relative to this
folder), and "@graph" in scene.json by the graph.
"""

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def _resolve(value):
    if isinstance(value, str) and value.startswith("@include:"):
        return (HERE / value[len("@include:"):]).read_text()
    if isinstance(value, dict):
        return {k: _resolve(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve(v) for v in value]
    return value


def graph():
    """The vision graph, with its rule's script inlined."""
    return _resolve(json.loads((HERE / "graph.json").read_text()))


def scene():
    """The scene definition (scene.json), every include and the graph inlined."""
    s = _resolve(json.loads((HERE / "scene.json").read_text()))
    g = graph()

    def fill(value):
        if value == "@graph":
            return g
        if isinstance(value, dict):
            return {k: fill(v) for k, v in value.items()}
        if isinstance(value, list):
            return [fill(v) for v in value]
        return value

    return fill(s)


if __name__ == "__main__":
    import sys

    what = sys.argv[1] if len(sys.argv) > 1 else "scene"
    print(json.dumps(graph() if what == "graph" else scene(), indent=2))
