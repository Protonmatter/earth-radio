// Pure HLS media-playlist segment parsing shared by the Node fingerprint sampler and
// the Cloudflare Pages Function (Workers runtime — keep this module free of Node
// imports, like platform-detect.mjs).

// Media-playlist segment walk with #EXT-X-BYTERANGE support: playlists that pack
// multiple fragments into one file address them as byte ranges of a repeated URI —
// without honoring the ranges a sampler would fetch the same file head repeatedly.
// An omitted @offset continues from the previous range's end for that URI (RFC 8216).
export function parseMediaSegments(lines) {
  const segments = [];
  let pendingRange = null;
  const lastEndByUri = new Map();
  for (const line of lines) {
    if (!line) continue;
    const rangeMatch = line.match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i);
    if (rangeMatch) {
      pendingRange = { length: Number(rangeMatch[1]), offset: rangeMatch[2] === undefined ? null : Number(rangeMatch[2]) };
      continue;
    }
    if (line.startsWith('#')) continue;
    let range = null;
    if (pendingRange && pendingRange.length > 0) {
      const offset = pendingRange.offset === null ? (lastEndByUri.get(line) || 0) : pendingRange.offset;
      range = { offset, length: pendingRange.length };
      lastEndByUri.set(line, offset + pendingRange.length);
    }
    pendingRange = null;
    segments.push({ uri: line, range });
  }
  return segments;
}

// The #EXT-X-MAP initialization segment (fMP4 decoder metadata), with its own
// optional BYTERANGE attribute. Returns [] or a one-element list so callers can
// spread it ahead of the media segments.
export function parseMapSegment(lines) {
  const mapLine = lines.find(line => /^#EXT-X-MAP:/i.test(line));
  const uri = mapLine?.match(/URI="([^"]+)"/i)?.[1];
  if (!uri) return [];
  const rangeMatch = mapLine.match(/BYTERANGE="(\d+)@(\d+)"/i);
  const range = rangeMatch ? { length: Number(rangeMatch[1]), offset: Number(rangeMatch[2]) } : null;
  return [{ uri, range }];
}

// Range request header value for a parsed segment, or '' when the whole resource
// is the segment.
export function rangeHeaderFor(segment) {
  if (!segment?.range) return '';
  return `bytes=${segment.range.offset}-${segment.range.offset + segment.range.length - 1}`;
}
