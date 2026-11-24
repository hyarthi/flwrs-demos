#!/usr/bin/env python3
"""Tests of the dog rule (dog.lua), on made-up frames.

Runs the graph's rule node through `flwrs-cv-source rule-test`, which
executes it exactly as the vision source does (same Lua sandbox, `held` /
`once`, state), with no camera and no models. Standard library only.

    python3 scene/tests/test_rule.py            # all tests
    python3 scene/tests/test_rule.py -k bark    # those whose name has "bark"

The plugin binary: $FLWRS_CV_SOURCE, else the one the installer built.
"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SCENE = HERE.parent
DEMO = SCENE.parent
sys.path.insert(0, str(SCENE))
import scene  # noqa: E402

FPS = 30
W, H = 1280, 720


def binary():
    env = os.environ.get("FLWRS_CV_SOURCE")
    if env:
        return env
    exe = "flwrs-cv-source.exe" if os.name == "nt" else "flwrs-cv-source"
    built = DEMO / ".build" / "target" / "cv_source" / "release" / exe
    if built.exists():
        return str(built)
    raise unittest.SkipTest(
        "no flwrs-cv-source: run ./install first, or set FLWRS_CV_SOURCE to the plugin's binary"
    )


def person(pid, x=640.0, arms_up=False, left=None, right=None):
    """A person facing the camera, centred at x; hands as (gesture, tip)."""
    kp = {
        "nose": [x, 200],
        "left_shoulder": [x + 60, 280],
        "right_shoulder": [x - 60, 280],
        "left_elbow": [x + 80, 360],
        "right_elbow": [x - 80, 360],
        "left_hip": [x + 40, 480],
        "right_hip": [x - 40, 480],
    }
    wrist_y = 200 if arms_up else 430
    kp["left_wrist"] = [x + 85, wrist_y]
    kp["right_wrist"] = [x - 85, wrist_y]
    obj = {
        "tracker_id": pid,
        "class_name": "person",
        "box": [x - 120, 150, x + 120, 700],
        "kp": {k: [v[0], v[1], 0.9] for k, v in kp.items()},
        "children": {},
    }
    for side, hand in (("left", left), ("right", right)):
        if hand is None:
            continue
        gesture, tip = hand
        wx, wy = kp[side + "_wrist"]
        h = {
            "box": [wx - 50, wy - 120, wx + 50, wy],
            "kp": {"index_finger_tip": tip or [wx, wy - 100]},
            "children": {side + "_gesture": [{"class_name": gesture, "confidence": 0.9}]},
        }
        obj["children"][side + "_hand"] = [h]
    return obj


class Timeline:
    """Frames at FPS: each `add(seconds, people_at(t))` appends frames."""

    def __init__(self):
        self.t = 0.0
        self.frames = []

    def add(self, seconds, people):
        n = round(seconds * FPS)
        for _ in range(n):
            ps = people(self.t) if callable(people) else people
            self.frames.append({"time": round(self.t, 4), "width": W, "height": H, "objects": ps})
            self.t += 1.0 / FPS
        return self

    def run(self):
        with tempfile.TemporaryDirectory() as tmp:
            g = pathlib.Path(tmp) / "graph.json"
            g.write_text(json.dumps(scene.graph()))
            f = pathlib.Path(tmp) / "frames.jsonl"
            f.write_text("\n".join(json.dumps(x) for x in self.frames))
            done = subprocess.run(
                [binary(), "rule-test", "--graph", str(g), "--node", "dog", "--frames", str(f)],
                capture_output=True,
                text=True,
            )
        if done.returncode != 0:
            raise AssertionError(f"rule-test failed ({done.returncode}): {done.stderr}")
        return [json.loads(line) for line in done.stdout.splitlines() if line.strip()]


def commands(events):
    return [(e["action"], round(e["time"], 2)) for e in events]


def names(events):
    return [e["action"] for e in events]


class DogRule(unittest.TestCase):
    def test_the_first_person_becomes_the_owner(self):
        ev = Timeline().add(1, [person(1)]).add(1, [person(1), person(2, x=300)]).run()
        self.assertEqual(names(ev), ["owner"])
        self.assertEqual(ev[0]["data"], {"command": "owner", "person": 1})

    def test_a_gesture_fires_after_half_a_second_and_once_per_hold(self):
        tl = Timeline().add(1, [person(1)])
        start = tl.t
        tl.add(0.4, [person(1, right=("thumb_up", None))]).add(0.5, [person(1)])
        tl.add(2.0, [person(1, right=("thumb_up", None))])
        ev = tl.run()
        wags = [e for e in ev if e["action"] == "wag"]
        # The 0.4 s flash doesn't count; the long hold fires once, ~0.5 s in.
        self.assertEqual(len(wags), 1, commands(ev))
        held_from = start + 0.9
        self.assertAlmostEqual(wags[0]["time"] - held_from, 0.5, delta=0.05)

    def test_every_static_gesture(self):
        mapping = {
            "thumb_up": "wag",
            "closed_fist": "sit",
            "open_palm": "stand",
            "thumb_down": "play_dead",
            "victory": "jump",
            "pointing_up": "turn",
            "i_love_you": None,
        }
        tl = Timeline().add(0.5, [person(1)])
        for gesture in mapping:
            tl.add(1.0, [person(1, left=(gesture, None))]).add(0.3, [person(1)])
        got = [n for n in names(tl.run()) if n != "owner"]
        self.assertEqual(got, [c for c in mapping.values() if c])

    def test_another_persons_hands_are_ignored(self):
        ev = (
            Timeline()
            .add(1, [person(1)])
            .add(2, [person(1), person(2, x=300, right=("thumb_up", None))])
            .run()
        )
        self.assertEqual(names(ev), ["owner"])

    def test_the_owner_leaving_then_another_after_the_cool_off(self):
        tl = Timeline().add(1, [person(1), person(2, x=300)])
        left_at = tl.t
        tl.add(6, [person(2, x=300, right=("thumb_up", None))])
        ev = tl.run()
        self.assertEqual(names(ev), ["owner", "owner_lost", "owner", "wag"], commands(ev))
        lost, picked = ev[1], ev[2]
        self.assertAlmostEqual(lost["time"], left_at, delta=0.05)
        self.assertAlmostEqual(picked["time"] - lost["time"], 5.0, delta=0.05)
        self.assertEqual(lost["data"]["person"], 1)
        self.assertEqual(picked["data"]["person"], 2)
        # During the cool-off nobody is obeyed: the wag comes after the pick.
        self.assertGreater(ev[3]["time"], picked["time"])

    def test_nobody_left_after_the_cool_off_is_idle(self):
        ev = Timeline().add(1, [person(1)]).add(6, []).add(1, [person(3)]).run()
        self.assertEqual(names(ev), ["owner", "owner_lost", "idle", "owner"], commands(ev))
        self.assertEqual(ev[3]["data"]["person"], 3)

    def test_bark_is_the_hand_opening_and_closing(self):
        tl = Timeline().add(0.5, [person(1)])
        for gesture in ["closed_fist", "open_palm", "closed_fist", "open_palm"]:
            tl.add(0.25, [person(1, right=(gesture, None))])
        tl.add(0.3, [person(1)])
        ev = tl.run()
        self.assertEqual(names(ev), ["owner", "bark"], commands(ev))

    def test_slow_alternation_is_not_a_bark(self):
        tl = Timeline().add(0.5, [person(1)])
        for gesture in ["closed_fist", "open_palm", "closed_fist", "open_palm"]:
            tl.add(1.0, [person(1, right=(gesture, None))])
        got = names(tl.run())
        self.assertNotIn("bark", got)
        self.assertEqual(got, ["owner", "sit", "stand", "sit", "stand"])

    def test_both_arms_up_is_paws_up(self):
        ev = Timeline().add(0.5, [person(1)]).add(0.4, [person(1, arms_up=True)]).add(
            0.3, [person(1)]
        ).add(1.0, [person(1, arms_up=True)]).run()
        self.assertEqual(names(ev), ["owner", "beg"], commands(ev))

    def test_walking_running_and_stopping(self):
        tl = Timeline().add(0.5, [person(1, x=200)])
        x0 = 200.0

        def moving(speed, start, t0):
            return lambda t: [person(1, x=start + speed * W * (t - t0))]

        t0 = tl.t
        tl.add(1.5, moving(0.25, x0, t0))  # walking right
        x1 = x0 + 0.25 * W * 1.5
        t1 = tl.t
        tl.add(1.0, moving(0.8, x1, t1))  # running right
        x2 = x1 + 0.8 * W * 1.0
        tl.add(1.5, [person(1, x=x2)])  # standing still
        ev = tl.run()
        got = [(e["action"], e["data"].get("direction")) for e in ev]
        self.assertEqual(
            got, [("owner", None), ("walk", "right"), ("run", "right"), ("stop", None)], got
        )

    def test_walking_left(self):
        tl = Timeline().add(0.5, [person(1, x=1000)])
        t0 = tl.t
        tl.add(1.5, lambda t: [person(1, x=1000 - 0.25 * W * (t - t0))])
        ev = tl.run()
        self.assertEqual(ev[1]["action"], "walk")
        self.assertEqual(ev[1]["data"]["direction"], "left")
        self.assertGreater(ev[1]["data"]["speed"], 0.12)


if __name__ == "__main__":
    unittest.main(verbosity=2)
