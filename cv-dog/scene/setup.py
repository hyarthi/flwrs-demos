#!/usr/bin/env python3
"""Talks to the demo's flwrs server over its REST API (standard library only).

    setup.py wait                    wait until the server answers
    setup.py plugins <dir>           install (or upgrade) every package ZIP in <dir>
    setup.py scene <models dir>      (re)create the cv-dog scene from scene.json,
                                     upload its files, and check it has no problems
    setup.py enable | disable        enable or disable the scene
    setup.py status                  the scene's state and its nodes'
    setup.py input-camera            the vision node reads the camera (scene.json's input)
    setup.py input-video <file>      ... or loops an MJPEG recording

The server: $FLWRS_API, else http://127.0.0.1:8077/api (scene/config.toml).
Re-running is safe: plugins are upgraded in place, and an existing scene
named like this one is deleted and created again.
"""

import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scene as scene_files  # noqa: E402

API = os.environ.get("FLWRS_API", "http://127.0.0.1:8077/api")


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"{status}: {body}")
        self.status = status
        self.body = body


def call(method, path, body=None, raw=None, content_type=None, timeout=120):
    data, headers = None, {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif raw is not None:
        data = raw
        headers["Content-Type"] = content_type or "application/octet-stream"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = res.read().decode() or "null"
            return json.loads(text) if text.strip() else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            text = json.loads(text)
        except ValueError:
            pass
        raise ApiError(e.code, text) from None


def wait(seconds=60):
    deadline = time.time() + seconds
    while True:
        try:
            call("GET", "/server/info", timeout=2)
            return
        except (OSError, ApiError):
            if time.time() > deadline:
                sys.exit(f"the flwrs server at {API} didn't answer within {seconds} s")
            time.sleep(0.3)


def multipart(field, path):
    boundary = uuid.uuid4().hex
    head = (
        f"--{boundary}\r\ncontent-disposition: form-data; name=\"{field}\"; "
        f"filename=\"{path.name}\"\r\ncontent-type: application/zip\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    return head + path.read_bytes() + tail, f"multipart/form-data; boundary={boundary}"


def plugins(folder):
    zips = sorted(pathlib.Path(folder).glob("*.zip"))
    if not zips:
        sys.exit(f"no plugin packages (*.zip) in {folder}")
    for z in zips:
        body, ctype = multipart("file", z)
        try:
            call("POST", "/plugins", raw=body, content_type=ctype)
            print(f"  installed {z.name}")
        except ApiError as e:
            if e.status != 409:
                sys.exit(f"installing {z.name}: {e}")
            # Already installed: upgrade it in place.
            call("PUT", f"/plugins/by-id/{plugin_id_of(z)}", raw=body, content_type=ctype)
            print(f"  upgraded {z.name}")


def plugin_id_of(zip_path):
    import zipfile

    with zipfile.ZipFile(zip_path) as z:
        return json.loads(z.read("manifest.json"))["id"]


def scenes():
    return call("GET", "/scenes?limit=1000").get("scenes", [])


def find_scene(name):
    return next((s for s in scenes() if s.get("name") == name), None)


def build_scene(models):
    spec = scene_files.scene()
    name = spec["name"]
    old = find_scene(name)
    if old:
        if old.get("enabled"):
            call("POST", f"/scenes/by-id/{old['id']}/disable")
        call("DELETE", f"/scenes/by-id/{old['id']}")
        print(f"  removed the previous {name} scene")
    created = call("POST", "/scenes", {"name": name})
    sid = created["id"]
    base = f"/scenes/by-id/{sid}"
    ids = {}
    for key, node in spec["nodes"].items():
        body = {"plugin_id": node["plugin_id"], "config": node["config"]}
        if "position" in node:
            body["position"] = node["position"]
        ids[key] = call("POST", f"{base}/nodes", body)["id"]
    for key, node in spec["nodes"].items():
        for upload in node.get("uploads", []):
            path = pathlib.Path(models) / upload
            if not path.exists():
                sys.exit(f"missing {path}: run the model download first")
            call("PUT", f"{base}/nodes/by-id/{ids[key]}/uploads/{upload}", raw=path.read_bytes(),
                 timeout=600)
            print(f"  uploaded {upload} to {key}")
    for edge in spec["edges"]:
        body = {"source_node_id": ids[edge["from"]], "target_node_id": ids[edge["to"]],
                "mapping": edge.get("mapping")}
        call("POST", f"{base}/edges", body)
    check = call("GET", f"{base}/check")
    for w in check.get("warnings", []):
        print(f"  warning: {w}")
    if check.get("problems"):
        for p in check["problems"]:
            print(f"  problem: {p}", file=sys.stderr)
        sys.exit("the scene has problems (above)")
    print(f"  scene {name} ready ({sid})")


def set_enabled(on):
    s = find_scene(scene_files.scene()["name"])
    if not s:
        sys.exit("no cv-dog scene: run ./install first")
    call("POST", f"/scenes/by-id/{s['id']}/{'enable' if on else 'disable'}", timeout=300)


def set_input(source):
    """Points the camera node at `source` (a launch-args `input`), if it differs."""
    spec = scene_files.scene()
    s = find_scene(spec["name"])
    if not s:
        sys.exit("no cv-dog scene: run ./install first")
    base = f"/scenes/by-id/{s['id']}"
    nodes = call("GET", f"{base}/nodes?limit=1000")
    nodes = nodes.get("nodes", nodes) if isinstance(nodes, dict) else nodes
    node = next((n for n in nodes if n.get("plugin_id") == "cv-source"), None)
    if not node:
        sys.exit("the scene has no cv-source node")
    config = node["config"]
    if config.get("launch_args", {}).get("input") == source:
        return
    config["launch_args"]["input"] = source
    call("PUT", f"{base}/nodes/by-id/{node['id']}", {"plugin_id": node["plugin_id"], "config": config},
         timeout=300)


def status():
    s = find_scene(scene_files.scene()["name"])
    if not s:
        sys.exit("no cv-dog scene")
    st = call("GET", f"/scenes/by-id/{s['id']}/status")
    nodes = {n.get("node_id"): n.get("status", {}).get("state") for n in st.get("nodes", [])}
    print(json.dumps({"state": st.get("state"), "nodes": nodes}))


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd = argv[0]
    if cmd == "wait":
        wait(int(argv[1]) if len(argv) > 1 else 60)
    elif cmd == "plugins":
        plugins(argv[1])
    elif cmd == "scene":
        build_scene(argv[1])
    elif cmd == "enable":
        set_enabled(True)
    elif cmd == "disable":
        set_enabled(False)
    elif cmd == "status":
        status()
    elif cmd == "input-camera":
        camera = scene_files.scene()["nodes"]["camera"]["config"]["launch_args"]["input"]
        set_input(camera)
    elif cmd == "input-video":
        set_input({"type": "mjpeg", "path": argv[1], "fps": 30, "loop": True})
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
