// Runtime-neutral public IP policy shared by Node and Cloudflare Pages.
// Parse each address into binary words once so alternate IPv6 spellings cannot
// bypass the stable special-purpose prefix policy.

const IPV4_DENY_PREFIXES = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 3]
];

const IPV6_GLOBALLY_REACHABLE_EXCEPTIONS = [
  [[0x2001, 0x0001, 0, 0, 0, 0, 0, 1], 128],
  [[0x2001, 0x0001, 0, 0, 0, 0, 0, 2], 128],
  [[0x2001, 0x0001, 0, 0, 0, 0, 0, 3], 128],
  [[0x2001, 0x0003], 32],
  [[0x2001, 0x0004, 0x0112], 48],
  [[0x2001, 0x0020], 28],
  [[0x2001, 0x0030], 28]
];

const IPV6_DENY_PREFIXES = [
  [[0x0064, 0xff9b, 0x0001], 48],
  [[0x0100, 0, 0, 0], 64],
  [[0x0100, 0, 0, 1], 64],
  [[0x2001, 0x0db8], 32],
  [[0x2002], 16],
  [[0x3ffe], 16],
  [[0x3fff, 0], 20],
  [[0x5f00], 16],
  [[0xfc00], 7],
  [[0xfe80], 10],
  [[0xfec0], 10],
  [[0xff00], 8]
];

// IANA IPv6 Address Space registry blocks explicitly classified "Reserved by
// IETF" rather than ordinary Global Unicast. Project-approved embedded forms in
// ::/8 are handled first and must still pass the effective IPv4 policy.
const IPV6_RESERVED_ADDRESS_SPACE_PREFIXES = [
  [[0x0000], 8],
  [[0x0100], 8],
  [[0x0200], 7],
  [[0x0400], 6],
  [[0x0800], 5],
  [[0x1000], 4],
  [[0x4000], 3],
  [[0x6000], 3],
  [[0x8000], 3],
  [[0xa000], 3],
  [[0xc000], 3],
  [[0xe000], 4],
  [[0xf000], 5],
  [[0xf800], 6],
  [[0xfe00], 9]
];

export function isPublicIpAddress(address) {
  const parsed = parseIpAddress(address);
  if (!parsed) return false;
  if (parsed.family === 4) return isPublicIpv4Bytes(parsed.bytes);
  return isPublicIpv6Words(parsed.words);
}

export function isIpAddress(address) {
  return parseIpAddress(address) !== null;
}

export function embeddedIpv4Address(address) {
  const parsed = parseIpAddress(address);
  if (!parsed || parsed.family !== 6) return '';
  const words = parsed.words;
  const mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every(word => word === 0);
  if (!mapped && !compatible) return '';
  return ipv4WordsToString(words[6], words[7]);
}

export function parseIpAddress(address) {
  let input = String(address || '').trim().toLowerCase();
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (!input || input.includes('%')) return null;

  const ipv4 = parseIpv4(input);
  if (ipv4) return { family: 4, bytes: ipv4 };
  if (!input.includes(':')) return null;

  const dottedIndex = input.lastIndexOf(':');
  if (input.includes('.') && dottedIndex >= 0) {
    const dotted = parseIpv4(input.slice(dottedIndex + 1));
    if (!dotted) return null;
    const high = (dotted[0] << 8) | dotted[1];
    const low = (dotted[2] << 8) | dotted[3];
    input = `${input.slice(0, dottedIndex)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = parseIpv6Side(halves[0]);
  const right = halves.length === 2 ? parseIpv6Side(halves[1]) : [];
  if (!left || !right) return null;
  if (halves.length === 1) {
    return left.length === 8 ? { family: 6, words: left } : null;
  }
  if (left.length + right.length >= 8) return null;
  return { family: 6, words: [...left, ...Array(8 - left.length - right.length).fill(0), ...right] };
}

function parseIpv4(input) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input)) return null;
  const bytes = input.split('.').map(Number);
  return bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : null;
}

function parseIpv6Side(input) {
  if (!input) return [];
  const tokens = input.split(':');
  if (tokens.some(token => !/^[0-9a-f]{1,4}$/.test(token))) return null;
  return tokens.map(token => Number.parseInt(token, 16));
}

function isPublicIpv4Bytes(bytes) {
  const value = (((bytes[0] << 24) >>> 0) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return !IPV4_DENY_PREFIXES.some(([prefix, bits]) => matchesIpv4Prefix(value, prefix, bits));
}

function isPublicIpv6Words(words) {
  const mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every(word => word === 0);
  const translated = words.slice(0, 4).every(word => word === 0) && words[4] === 0xffff && words[5] === 0;
  if (mapped || compatible || translated) return isPublicIpv4Words(words[6], words[7]);

  if (matchesIpv6Prefix(words, [0x0064, 0xff9b, 0, 0, 0, 0], 96)) {
    return isPublicIpv4Words(words[6], words[7]);
  }

  if (matchesIpv6Prefix(words, [0x2001, 0], 23)) {
    if (IPV6_GLOBALLY_REACHABLE_EXCEPTIONS.some(([prefix, bits]) => matchesIpv6Prefix(words, prefix, bits))) {
      return true;
    }
    return false;
  }

  return !IPV6_DENY_PREFIXES.some(([prefix, bits]) => matchesIpv6Prefix(words, prefix, bits)) &&
    !IPV6_RESERVED_ADDRESS_SPACE_PREFIXES.some(([prefix, bits]) => matchesIpv6Prefix(words, prefix, bits));
}

function isPublicIpv4Words(high, low) {
  return isPublicIpv4Bytes([high >>> 8, high & 0xff, low >>> 8, low & 0xff]);
}

function ipv4WordsToString(high, low) {
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function matchesIpv4Prefix(value, prefix, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (prefix & mask) >>> 0;
}

function matchesIpv6Prefix(words, prefix, bits) {
  const completeWords = Math.floor(bits / 16);
  for (let index = 0; index < completeWords; index += 1) {
    if (words[index] !== (prefix[index] || 0)) return false;
  }
  const remainingBits = bits % 16;
  if (!remainingBits) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (words[completeWords] & mask) === ((prefix[completeWords] || 0) & mask);
}
