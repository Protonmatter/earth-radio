// Shared HLS media-playlist tail selection for fingerprint sampling.
// Pages Functions and the desktop proxy must parse the same RFC 8216 byte-range rules.

export const HLS_SEGMENT_COUNT = 3;

function resolveSubRange(length, explicitOffset, previous, uri) {
  // An omitted @offset continues at the next byte after the previous sub-range of
  // the same resource (RFC 8216 §4.3.2.2 for segments, §4.3.2.5 for EXT-X-MAP).
  const offset = explicitOffset ?? (previous?.uri === uri && previous.range
    ? previous.range.offset + previous.range.length
    : 0);
  return { offset, length };
}

function sameHlsMap(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.uri !== right.uri) return false;
  const leftRange = left.range || null;
  const rightRange = right.range || null;
  if (!leftRange && !rightRange) return true;
  if (!leftRange || !rightRange) return false;
  return leftRange.offset === rightRange.offset && leftRange.length === rightRange.length;
}

export function coherentHlsTail(lines, { segmentCount = HLS_SEGMENT_COUNT } = {}) {
  let activeMap = null;
  let keyMethod = 'NONE';
  let pendingRange = null;
  let previous = null;
  const media = [];
  for (const line of lines) {
    const mapMatch = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/i);
    if (mapMatch) {
      const uri = mapMatch[1];
      const mapRange = line.match(/BYTERANGE="(\d+)(?:@(\d+))?"/i);
      let range = null;
      if (mapRange) {
        range = resolveSubRange(
          Number(mapRange[1]),
          mapRange[2] === undefined ? null : Number(mapRange[2]),
          previous,
          uri
        );
        previous = { uri, range };
      }
      activeMap = { uri, range };
      continue;
    }
    const declaredMethod = line.match(/^#EXT-X-KEY:.*METHOD=([\w-]+)/i)?.[1];
    if (declaredMethod) {
      keyMethod = declaredMethod.toUpperCase();
      continue;
    }
    const rangeMatch = line.match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i);
    if (rangeMatch) {
      pendingRange = { length: Number(rangeMatch[1]), offset: rangeMatch[2] === undefined ? null : Number(rangeMatch[2]) };
      continue;
    }
    if (line && !line.startsWith('#')) {
      let range = null;
      if (pendingRange) {
        range = resolveSubRange(pendingRange.length, pendingRange.offset, previous, line);
        pendingRange = null;
      }
      const segment = { uri: line, map: activeMap, range, encrypted: keyMethod !== 'NONE' };
      media.push(segment);
      previous = segment;
    }
  }

  const recent = media.slice(-segmentCount);
  if (!recent.length) return { segments: [], map: null, encrypted: false };
  const map = recent.at(-1).map;
  let coherentStart = recent.length - 1;
  while (coherentStart > 0 && sameHlsMap(recent[coherentStart - 1].map, map)) coherentStart -= 1;
  const segments = recent.slice(coherentStart);
  return {
    segments: segments.map(({ uri, range }) => ({ uri, range })),
    map,
    encrypted: segments.some(segment => segment.encrypted)
  };
}
