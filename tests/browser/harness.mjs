// Runs the Electron rendered-browser harness once per Node process and shares the results.
//
// Rendered evidence needs a real engine, so the harness is skipped (not failed) when the
// vendored Electron binary or a usable display is unavailable. Callers must report the skip.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(harnessDirectory, '..', '..');

const EVIDENCE_DIRECTORY = path.join(repositoryRoot, 'evidence', 'responsive-ui');

function electronBinary() {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const candidate = path.join(repositoryRoot, 'node_modules', '.bin', `electron${suffix}`);
  return existsSync(candidate) ? candidate : '';
}

export function rendererUnavailableReason() {
  if (!electronBinary()) return 'Electron is not installed in node_modules; run npm ci to capture rendered evidence.';
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return 'No display server is available for the rendered browser harness.';
  }
  return '';
}

let pending = null;

export async function retryKnownCaptureError(operation, {
  maxAttempts = 3,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay))
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const transient = String(error?.message || error).includes('UnknownVizError');
      if (!transient || attempt === maxAttempts) throw error;
      await wait(150 * attempt);
    }
  }
  throw new Error('capture retry exhausted unexpectedly');
}

export function runRenderedHarness({ outputDirectory = EVIDENCE_DIRECTORY, only = [] } = {}) {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const binary = electronBinary();
    if (!binary) {
      reject(new Error(rendererUnavailableReason()));
      return;
    }
    const args = [path.join(harnessDirectory, 'harness-main.mjs'), `--out=${outputDirectory}`];
    if (only.length) args.push(`--only=${only.join(',')}`);
    // The Windows launcher is a .cmd shim, so it must go through a shell. cmd.exe splits on
    // unquoted spaces and backslashes, so the command is quoted here instead of relying on
    // spawn's argument array, which is concatenated verbatim when shell is enabled.
    const useShell = process.platform === 'win32';
    const child = useShell
      ? spawn([binary, ...args].map(value => `"${value}"`).join(' '), {
        cwd: repositoryRoot,
        shell: true,
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      : spawn(binary, args, {
        cwd: repositoryRoot,
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', async code => {
      try {
        const payload = JSON.parse(await readFile(path.join(outputDirectory, 'results.json'), 'utf8'));
        if (!payload.complete) {
          const finished = new Set(payload.results.map(result => result.id));
          const missing = (payload.expected ?? []).filter(id => !finished.has(id));
          reject(new Error(`Rendered harness stopped after ${payload.results.length} scenarios (exit ${code}). Missing: ${missing.join(', ')}\n${stderr || stdout}`));
          return;
        }
        // Chromium frequently reports a non-zero teardown status on Windows even after every
        // scenario succeeded, so completeness comes from the payload rather than the exit code.
        resolve({ ...payload, exitCode: code, stdout, stderr });
      } catch (error) {
        reject(new Error(`Rendered harness produced no results (exit ${code}).\n${stderr || stdout}\n${error}`));
      }
    });
  });
  return pending;
}

export function byId(results, id) {
  const found = results.find(result => result.id === id);
  if (!found) throw new Error(`Rendered scenario is missing: ${id}`);
  if (found.error) throw new Error(`Rendered scenario ${id} failed: ${found.error}`);
  return found;
}

export function overlapArea(first, second) {
  if (!first || !second) return 0;
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > 0 && height > 0 ? width * height : 0;
}
