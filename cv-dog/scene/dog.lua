-- Dog commands from one person's gestures.
--
-- The body of `function(frame, objects, tracks, state)` in a flwrs vision
-- source's Lua rule node (see graph.json). `objects` are the tracked people,
-- each with its COCO-17 pose (`kp`) and, under `children`, what the hand
-- models found in a crop around each wrist: `left_hand` / `right_hand`
-- (21 landmarks, `kp`), each with its gesture class (`left_gesture` /
-- `right_gesture`). Only hands at the owner's own wrists are ever seen, so
-- other people's gestures are ignored by construction.
--
-- Returns events {event = "dog", action = <command>, data = {...}}; the
-- scene's edge mapping turns them into the page's SSE messages.

---------------------------------------------------------------------------
-- Settings
---------------------------------------------------------------------------

-- Seconds a gesture or pose must hold before the dog reacts.
local HOLD_S = 0.5
-- Least classifier confidence for a hand gesture to count.
local MIN_GESTURE = 0.5
-- Least confidence for a body keypoint to count.
local MIN_KEYPOINT = 0.3
-- After the owner leaves: seconds before another person is picked.
local COOLOFF_S = 5.0

-- Static hand gestures and the commands they give.
local COMMANDS = {
  thumb_up = "wag",
  closed_fist = "sit",
  open_palm = "stand",
  thumb_down = "play_dead",
  victory = "jump",
  pointing_up = "turn",
}

-- Bark: the hand opening and closing (fist <-> palm) this many times...
local BARK_SWITCHES = 3
-- ...within this many seconds.
local BARK_WINDOW_S = 2.0
-- Each fist or palm in a bark is shown for at most this long (a longer one
-- is a sit or a stand, and starts the count over).
local BARK_MAX_PHASE_S = 0.6
-- After a bark: seconds the static fist / palm commands stay quiet.
local BARK_QUIET_S = 0.8

-- Walking / running: the owner's horizontal speed, in frame widths per
-- second, smoothed over about SPEED_SMOOTH_S.
local SPEED_SMOOTH_S = 0.4
local WALK_SPEED = 0.12
local RUN_SPEED = 0.5
-- Below this the owner has stopped (lower than WALK_SPEED: hysteresis).
local STOP_SPEED = 0.06
-- Seconds a new speed band must hold before the dog changes gait...
local GAIT_HOLD_S = 0.3
-- ...except from running to walking: slowing down from a run passes through
-- walking speed for a moment, so only a sustained walk counts.
local RUN_TO_WALK_HOLD_S = 0.8

---------------------------------------------------------------------------

local now = frame.time
local out = {}

local function emit(command, extra)
  local data = {command = command, person = state.owner}
  for k, v in pairs(extra or {}) do data[k] = v end
  out[#out + 1] = {event = "dog", action = command, tracker_id = state.owner, data = data}
  state.last = command
end

local function seen(p) return p and pose.visible(p, MIN_KEYPOINT) end

-- People present now, by track id.
local people = {}
for _, o in ipairs(objects) do
  if o.tracker_id then people[o.tracker_id] = o end
end
-- Tracks still known (a person hidden for a moment keeps theirs).
local alive = {}
for _, t in ipairs(tracks) do alive[t.id] = t end

-- Owner bookkeeping ---------------------------------------------------------

local function forget_owner_state()
  state.speed, state.gait, state.prev_x, state.prev_t = nil, nil, nil, nil
  state.switches, state.last_shape, state.shape_since, state.quiet_until = {}, nil, nil, nil
end

if state.owner and not alive[state.owner] then
  emit("owner_lost")
  state.owner = nil
  state.lost_at = now
  forget_owner_state()
end

if not state.owner then
  local cooling = state.lost_at and now - state.lost_at < COOLOFF_S
  if not cooling then
    -- The person who's been here longest: the first to enter, or, after a
    -- cool-off, anyone present.
    local pick, oldest
    for _, t in ipairs(tracks) do
      if people[t.id] and not t.lost and (not oldest or t.age > oldest) then
        pick, oldest = t.id, t.age
      end
    end
    if pick then
      state.owner = pick
      state.lost_at = nil
      forget_owner_state()
      emit("owner")
    elseif state.lost_at then
      -- The cool-off is over and nobody is here.
      state.lost_at = nil
      emit("idle")
    end
  end
end

local me = state.owner and people[state.owner]
if not me then return out end

-- Hands -----------------------------------------------------------------------

-- Each wrist's hand: its gesture (or "none") and the hand object.
local hands = {}
for _, side in ipairs({"right", "left"}) do
  local list = me.children[side .. "_hand"]
  local hand = list and list[1]
  local g = "none"
  if hand then
    local c = hand.children[side .. "_gesture"]
    c = c and c[1]
    if c and c.confidence >= MIN_GESTURE and c.class_name then g = c.class_name end
  end
  hands[#hands + 1] = {side = side, hand = hand, gesture = g}
end
-- The gesture shown: the first hand showing one (right first).
local shown = "none"
for _, h in ipairs(hands) do
  if h.gesture ~= "none" then shown = h.gesture; break end
end

-- Bark: fist <-> palm switches within the window.
local shape = (shown == "closed_fist" or shown == "open_palm") and shown or nil
if shape and shape ~= state.last_shape then
  if state.last_shape then
    if now - (state.shape_since or now) > BARK_MAX_PHASE_S then
      state.switches = {}
    end
    state.switches[#state.switches + 1] = now
  end
  state.last_shape = shape
  state.shape_since = now
end
local recent = {}
for _, t in ipairs(state.switches) do
  if now - t <= BARK_WINDOW_S then recent[#recent + 1] = t end
end
state.switches = recent
if #recent >= BARK_SWITCHES then
  emit("bark")
  state.switches = {}
  state.quiet_until = now + BARK_QUIET_S
end
local quiet = state.quiet_until and now < state.quiet_until

-- Static gestures: held, then once per hold.
for gesture, command in pairs(COMMANDS) do
  local on = shown == gesture
  local fire = once("g:" .. gesture, held("g:" .. gesture, on, HOLD_S))
  local barking = (gesture == "closed_fist" or gesture == "open_palm") and quiet
  if fire and not barking then emit(command) end
end

-- Paws up: both wrists above their shoulders.
local k = me.kp
local up = seen(k.left_wrist) and seen(k.left_shoulder) and seen(k.right_wrist)
  and seen(k.right_shoulder) and k.left_wrist.y < k.left_shoulder.y
  and k.right_wrist.y < k.right_shoulder.y
if once("beg", held("beg", up, HOLD_S)) then emit("beg") end

-- Walking / running: the owner's box centre, smoothed.
local x = (me.box.x1 + me.box.x2) / 2
if state.prev_t and now > state.prev_t then
  local v = (x - state.prev_x) / (now - state.prev_t) / frame.width
  local a = 1 - math.exp(-(now - state.prev_t) / SPEED_SMOOTH_S)
  state.speed = (state.speed or 0) + a * (v - (state.speed or 0))
end
state.prev_x, state.prev_t = x, now
local speed = math.abs(state.speed or 0)
local band
if speed >= RUN_SPEED then band = "run"
elseif speed >= WALK_SPEED then band = "walk"
elseif speed < STOP_SPEED then band = "stop"
else band = state.gait or "stop" end
local gait = state.gait or "stop"
for _, b in ipairs({"run", "walk", "stop"}) do
  local hold = (gait == "run" and b == "walk") and RUN_TO_WALK_HOLD_S or GAIT_HOLD_S
  if held("gait:" .. b, band == b, hold) and b ~= gait then
    state.gait = b
    if b == "stop" then
      emit("stop")
    else
      emit(b, {direction = (state.speed or 0) >= 0 and "right" or "left", speed = speed})
    end
  end
end

return out
