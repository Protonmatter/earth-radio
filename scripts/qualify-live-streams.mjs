// Explicit opt-in release diagnostic. No audio or raw endpoint URLs are persisted.
// Uses the application's public-IP/DNS/redirect guard before local codec analysis.
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { requestPublic } from '../server/net-guard.mjs';

if (!process.argv.includes('--live')) throw new Error('Pass --live to run bounded external stream checks.');
const output = path.resolve('.build/qualification/live-streams.json');
const startedAt = new Date().toISOString();
const directory = await requestPublic('https://de1.api.radio-browser.info/json/stations/topclick/40', {
  deadlineAt: Date.now() + 20000, maxBytes: 1024 * 1024
});
if (directory.statusCode !== 200 || directory.truncated) throw new Error('Live directory response is unavailable or exceeds its byte limit.');
const stations = JSON.parse(directory.body.toString('utf8'));
if (!Array.isArray(stations)) throw new Error('Invalid directory response.');
const candidates = stations.filter(station => {
  try {
    const url = new URL(station.url_resolved || station.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !station.hls &&
      !/\.(m3u8?|pls)(?:$|\/)/i.test(url.pathname) && ['MP3', 'AAC', 'AAC+'].includes(station.codec);
  } catch { return false; }
});
// One AAC and up to two MP3 endpoints: a declared-codec sample, not a prevalence study.
const selected = [candidates.find(s => s.codec.startsWith('AAC')), ...candidates.filter(s => s.codec === 'MP3').slice(0, 2)].filter(Boolean);
const results = [];
for (const station of selected) {
  const record = { stationUuid: station.stationuuid, name: station.name, declaredCodec: station.codec,
    declaredBitrateKbps: station.bitrate, streamHost: new URL(station.url_resolved || station.url).hostname };
  try {
    const begin = performance.now();
    const response = await requestPublic(station.url_resolved || station.url, { deadlineAt: Date.now() + 25000, maxBytes: 128 * 1024 });
    record.httpStatus = response.statusCode; record.bytes = response.body.length;
    record.elapsedMs = Math.round(performance.now() - begin); record.redirects = response.hops;
    record.contentType = String(response.headers['content-type'] || '');
    if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', '-i', 'pipe:0'], {
      input: response.body, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
    });
    if (probe.error || probe.status !== 0) throw new Error('Local codec probe failed');
    const audio = JSON.parse(probe.stdout.toString()).streams?.find(s => s.codec_type === 'audio');
    if (!audio) throw new Error('No audio stream decoded');
    record.decodedCodec = audio.codec_name; record.sampleRateHz = Number(audio.sample_rate); record.channels = audio.channels;
    const decode = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', 'pipe:0', '-t', '5', '-vn',
      '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'], {
      input: response.body, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
    });
    const log = decode.stderr.toString();
    const number = label => { const matches = [...log.matchAll(new RegExp(`${label}: ([^\\r\\n]+)`, 'g'))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
    record.peakDbfs = number('Peak level dB'); record.rmsDbfs = number('RMS level dB'); record.decodedSamples = number('Number of samples');
    record.decoderExit = decode.status; record.decoderErrorLines = log.split(/\r?\n/).filter(line => /error while decoding|invalid data|corrupt/i.test(line)).length;
    record.decodedNonSilentAudio = decode.status === 0 && Number.isFinite(record.rmsDbfs) && record.decodedSamples > 0;
    record.partialSample = true;
  } catch (error) { record.failure = String(error.message).replace(/https?:\/\/\S+/g, '<endpoint>').slice(0, 160); }
  results.push(record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
const report = { startedAt, completedAt: new Date().toISOString(), directory: { requested: 40, returned: stations.length,
  directoryCheckPassed: stations.filter(s => s.lastcheckok === 1).length, httpsEndpoints: stations.filter(s => String(s.url_resolved || '').startsWith('https://')).length },
  maxBytesPerStream: 128 * 1024, maxStreamTimeMs: 25000, results,
  limitations: ['Point-in-time bounded samples only; directory health is a third-party claim.',
    'PCM decoding and signal levels do not establish perceptual fidelity or playback-device quality.',
    'Partial compressed samples may end mid-frame. No copyrighted audio clips are saved.'] };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Wrote ${path.relative(process.cwd(), output)}\n`);
if (results.length !== 3 || results.some(result => !result.decodedNonSilentAudio)) process.exitCode = 1;
