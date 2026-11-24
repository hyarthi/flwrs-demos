# cv-dog: the scene

The flwrs side of the demo: a vision graph that watches one person and turns
their gestures into dog commands, and a scene that sends those commands to
the page as Server-Sent Events. Built and run by [`../install`](../install)
and [`../run`](../run); the page is described in [`../README.md`](../README.md).

## Install and run

```sh
./install                         # the newest flwrs release (a v<version> tag)
./install --ref main              # or a flwrs branch, tag or commit
./install --flwrs ~/src/flwrs     # or a local flwrs checkout, as it is (development)
./run                             # then open http://127.0.0.1:8078/
./run --video clip.mjpeg          # a looped MJPEG recording instead of the camera
```

Until flwrs has its first release, `./install` alone stops and asks for
`--ref` (`--ref main` builds the newest code). `FLWRS_REPO` clones flwrs from
somewhere else (a URL or a local path).

`./install` needs git, curl, python3 (3.8+), a C compiler, Rust at the
`rust-version` flwrs asks for, and Node.js 20.19+ with npm (the server's web
UI). It:

1. clones [flwrs](https://github.com/hyarthi/flwrs) into `.flwrs/` (or uses
   `--flwrs <path>`) and checks out the newest release, `--ref` otherwise.
   With no release yet and no `--ref`, it stops and says so;
2. builds the server (`bin/flwrs-app`) and packages the plugins the scene
   uses, listed in [`plugins.txt`](plugins.txt) (`packages/*.zip`), with
   `cargo trellis package`, each in its own target folder under `.build/`
   (`--plugins a,b` builds those instead, `--plugins all` every flwrs
   plugin; `--debug` makes debug builds, quicker to build);
3. downloads the models into `models/`, each pinned to a commit and checked
   against its SHA-256 ([`models.txt`](models.txt)): a mismatch stops it;
4. starts the server with [`config.toml`](config.toml) (all runtime data in
   `.data/`), installs the plugins (upgrading ones already there), creates the
   scene from [`scene.json`](scene.json) (an earlier `cv-dog` scene is
   deleted first), uploads the models, checks the scene has no problems, and
   stops the server.

Everything it makes is gitignored and stays in `cv-dog/`. Re-running it is
safe. `./run` starts the server, points the vision node at the camera (or
`--video`), enables the scene, serves the page on port 8078, and on Ctrl+C
disables the scene and stops the server. The server's own UI is at
http://127.0.0.1:8077/ while it runs: the scene, its nodes' logs and the
graph's live view.

On macOS the first run asks for camera access for the terminal the server
was started from.

**Windows:** `install.ps1` and `run.ps1` do the same, with the same options
in PowerShell style (`-Ref`, `-Flwrs`, `-Plugins`, `-DebugBuild`; `-Open`,
`-Video`). They need git, Python 3.8+ (`py -3`, `python3` or `python`; the
Microsoft Store stub isn't enough), Rust with the MSVC build tools, and
Node.js 20.19+. They are **untested on Windows** (flwrs itself has no
Windows CI yet), and are kept in step with the shell scripts by hand. One
difference: Windows has no way to send a console Ctrl+C to the server in its
own window, so on Ctrl+C `run.ps1` disables the scene (which shuts its nodes
down properly) and then ends the server process.

## Files

| File | What it is |
|---|---|
| `scene.json` | The scene: the vision node (`cv-source`) and the push sink (`http-push-sink`, SSE on `127.0.0.1:8090`, channel `dog`), and the edge between them. `"@graph"` and `"@include:<file>"` are filled in by `scene.py`. |
| `graph.json` | The vision graph (below). |
| `dog.lua` | The rule that turns what the graph sees into commands. Every threshold is a named setting at its top. |
| `mapping.lua` | The edge's mapping: a rule event becomes the SSE message the page reads. |
| `models.txt` | The models: file, SHA-256, pinned URL, license, source. |
| `plugins.txt` | The flwrs plugins the scene uses: what the installer builds. |
| `config.toml` | The demo's flwrs server settings (ports 8077 and 8090, data in `.data/`). |
| `setup.py` | The REST calls the scripts make (Python 3, standard library only). |
| `scene.py` | Reads `scene.json` / `graph.json` with their includes. |
| `tests/test_rule.py` | Tests of `dog.lua` on made-up frames. |

## The graph

On each frame, MoveNet MultiPose finds people and their 17 body keypoints;
a tracker gives each person a lasting id. For every tracked person, a crop
around each wrist (turned along the forearm) goes to MediaPipe's hand
landmark model, and the landmarks to its gesture embedder and classifier.
So a hand is always attached to the person whose wrist it's at, and the rule
only ever looks at its owner's hands. On an Apple M2 the graph runs at about
35 frames per second on the CPU (MoveNet about 15 ms, each hand about 7 ms).

## Commands

The page receives one SSE message per command, on channel `dog`, with the
command as the event name and this JSON as its data:

```json
{"command": "walk", "person": 3, "time": "2026-11-24T17:05:01.250Z", "direction": "right", "speed": 0.27}
```

`person` is the owner's track id, `time` the frame's capture time. A command
is sent when it happens, not repeated every frame.

| Command | When |
|---|---|
| `owner` | Someone became the owner: the first person in view, or after a cool-off. The dog greets them. |
| `owner_lost` | The owner left the frame. The dog sits for the 5 s cool-off; nobody is obeyed meanwhile. |
| `idle` | The cool-off ended and nobody is there. |
| `wag` | 👍 thumb up |
| `sit` | ✊ fist |
| `stand` | ✋ open palm |
| `play_dead` | 👎 thumb down |
| `jump` | ✌️ victory |
| `bark` | the hand opening and closing: fist ↔ palm three times within 2 s, each shown under 0.6 s |
| `beg` | both wrists above the shoulders |
| `turn` | ☝️ pointing up |
| `walk` / `run` | the owner moving sideways (`direction`: `left` / `right` as seen in the camera image, not the owner's own left and right; `speed`: frame widths per second) |
| `stop` | the owner stopped moving |

Every gesture and pose must hold for 0.5 s before the dog reacts (gait
changes 0.3 s), and fires once per hold. 🤟 "I love you" is free.

Directions stay as the camera image shows them. The page mirrors them by
default, so the dog walks the way the person walks on a mirrored screen
(its setting turns that off).

## Testing the rule

```sh
python3 scene/tests/test_rule.py
```

The tests run `dog.lua` through `flwrs-cv-source rule-test`: the plugin
runs the graph's rule node on frames written as JSON lines, exactly as it
runs in a node (same Lua sandbox, timers on the frames' clock), with no
camera and no models. They use the plugin binary `./install` built, or the
one `FLWRS_CV_SOURCE` names. They cover the owner (first person, leaving,
the cool-off, someone else's hands ignored), every gesture's 0.5 s hold and
once-per-hold, bark, paws up, and walking, running and stopping.

To try the whole graph on a recording without the server:

```sh
.build/target/cv_source/release/flwrs-cv-source debug \
  --settings <(python3 -c 'import json,sys; sys.path.insert(0,"scene"); import scene; print(json.dumps({"graph": scene.graph()}))') \
  --files models --video clip.mjpeg
```

## Models

| File | Model | License |
|---|---|---|
| `movenet_multi.onnx` | MoveNet MultiPose Lightning (Google), ONNX by [Xenova](https://huggingface.co/Xenova/movenet-multipose-lightning) | Apache-2.0 |
| `gesture_hand_lm.onnx`, `gesture_embedder.onnx`, `gesture_classifier.onnx` | MediaPipe Gesture Recognizer (Google), ONNX by [anira-project](https://huggingface.co/anira-project/mediapipe-gesture-recognizer) | Apache-2.0 |
