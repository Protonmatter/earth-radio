// Pure ICY metadata extraction from a raw byte window of an Icy-MetaData:1 response.
// No Node APIs (Uint8Array + TextDecoder only): shared by the Cloudflare Pages Function
// and unit tests. The desktop proxy keeps its own streaming variant.

// Scans interleaved [metaint audio bytes][1 length byte][length*16 metadata bytes]
// blocks and returns the first non-empty StreamTitle, or ''.
export function extractIcyTitle(bytes, metaint) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const interval = Number(metaint);
  if (!Number.isFinite(interval) || interval <= 0) return '';

  let offset = interval;
  while (offset < data.length) {
    const metadataLength = data[offset] * 16;
    const start = offset + 1;
    if (metadataLength > 0) {
      if (start + metadataLength > data.length) return '';
      const title = parseIcyTitle(decodeMetadata(data.subarray(start, start + metadataLength)));
      if (title) return title;
    }
    offset = start + metadataLength + interval;
  }
  return '';
}

export function parseIcyTitle(metadata) {
  const text = String(metadata || '');
  const match = text.match(/StreamTitle='([^']*)'/i) || text.match(/StreamTitle="([^"]*)"/i);
  return match ? match[1].trim() : '';
}

function decodeMetadata(bytes) {
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    decoded = new TextDecoder('windows-1252').decode(bytes);
  }
  return decoded.replace(/\0+$/g, '').trim();
}

// How many bytes of an ICY stream must be read to see at least `blocks` metadata
// blocks, bounded so a huge advertised metaint cannot make the reader buffer forever.
export function icyReadBudget(metaint, blocks = 2, cap = 640 * 1024) {
  const interval = Number(metaint);
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  return Math.min(cap, (interval + 1 + 255 * 16) * Math.max(1, blocks));
}
