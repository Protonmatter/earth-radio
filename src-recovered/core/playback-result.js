// Truthful navigation contract: callers cannot confuse a candidate station with a
// stream that actually started playing.
export function playbackResult(station, ok) {
  return ok && station ? { station, ok: true } : { station: null, ok: false };
}
