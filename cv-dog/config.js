// Defaults for the page. Query parameters override them, e.g.
//   index.html?sink=http://127.0.0.1:8090&channel=dog&debug=1
window.CVDOG_CONFIG = {
  // The flwrs HTTP push sink: base URL (with its base_path, if any).
  sink: 'http://127.0.0.1:8090',
  // The channel the scene publishes the dog's commands to.
  channel: 'dog',
  // Full stream URL; overrides sink + channel when set.
  stream: '',
  // Drop commands whose `time` is older than this (ms; 0 = keep all).
  stale_ms: 3000,
  // Walk / run as in a mirror: the dog goes the way the person goes from
  // their own point of view, as a front-facing webcam shows them mirrored.
  // false: as the camera's picture shows it.
  mirror: true,
  // Show a short caption when the dog's owner changes or leaves.
  captions: true,
  // Show the debug panel at start.
  debug: false,
  // Always use the text dog, even if the purchased art is there.
  ascii: false,
  // Where the purchased art's Spriter file is, relative to this page.
  rig: 'assets/dog/spriter_file_and_body_parts/alsation.scml',
};
