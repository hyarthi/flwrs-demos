-- The edge from the vision source to the HTTP push sink: a dog command
-- (a Lua rule event) becomes one SSE message on channel "dog", its data the
-- command's JSON plus the frame's capture time (RFC 3339, UTC).
--
-- The body of `function(payload, meta)` (an edge mapping's `script`);
-- the edge's `filter` lets only the rule's "dog" events through.

local function rfc3339(ms)
  local s = ms // 1000
  local days, rem = s // 86400, s % 86400
  -- Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
  local z = days + 719468
  local era = z // 146097
  local doe = z - era * 146097
  local yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
  local y = yoe + era * 400
  local doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
  local mp = (5 * doy + 2) // 153
  local d = doy - (153 * mp + 2) // 5 + 1
  local m = mp < 10 and mp + 3 or mp - 9
  if m <= 2 then y = y + 1 end
  return string.format("%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
    y, m, d, rem // 3600, rem % 3600 // 60, rem % 60, ms % 1000)
end

local data = json.decode(payload.data or "{}")
data.time = rfc3339(payload.frame_time)
return {
  channel = "dog",
  event = payload.action,
  data = json.encode(data),
  content_type = "application/json",
}
