#!/usr/bin/env node
// Local rehearsal only: real application and real disposable demo emulators.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';

export const REHEARSAL_PROJECT = 'demo-workflow-configuration';
export const REHEARSAL_ORIGIN = 'http://127.0.0.1:4174';
const root = fileURLToPath(new URL('../', import.meta.url));
export function rehearsalEnvironment(input = {}) {
  // Inherit only process tooling and the local endpoints injected by Firebase CLI.
  // Dedicated provider acceptance callables must not inherit any provider secret.
  const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR', 'JAVA_HOME', 'CLOUDSDK_CONFIG', 'XDG_CONFIG_HOME', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']);
  const env = Object.fromEntries(Object.entries(input).filter(([name]) => allowed.has(name)));
  return { ...env, ...(env.CLOUDSDK_CONFIG ? { GOOGLE_APPLICATION_CREDENTIALS: path.join(env.CLOUDSDK_CONFIG, 'provider-credentials-unavailable.json') } : {}), GCLOUD_PROJECT: REHEARSAL_PROJECT, GOOGLE_CLOUD_PROJECT: REHEARSAL_PROJECT,
    EVENT_OPERATING_SPINE_ENABLED: 'true', COMMERCIAL_CHANGE_AUTHORITY_ENABLED: 'true',
    NOTIFICATIONS_EMAIL_PROVIDER: 'none', NOTIFICATIONS_SMS_PROVIDER: 'none', REVENUE_AUTOPILOT_SENDS_ENABLED: 'false',
    BUYER_ACCESS_ENABLED: 'false', STRIPE_MODE: 'test',
    STAFF_INVITATION_TOKEN_SECRET: 'local-staff-invitation-token-secret-32-bytes-minimum',
    VITE_FIREBASE_API_KEY: 'demo-local-rehearsal', VITE_FIREBASE_PROJECT_ID: REHEARSAL_PROJECT,
    VITE_FIREBASE_AUTH_DOMAIN: `${REHEARSAL_PROJECT}.firebaseapp.com`, VITE_FIREBASE_APP_ID: 'demo-local-rehearsal',
    VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_AUTH_EMULATOR_PORT: '9399', VITE_FIRESTORE_EMULATOR_PORT: '8383', VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5601',
    VITE_FIREBASE_FUNCTIONS_REGION: 'us-central1', VITE_APP_URL: `${REHEARSAL_ORIGIN}/app`,
    VITE_APP_HOST: '127.0.0.1', VITE_AMBIENT_UI_ENABLED: 'true', VITE_EVENT_OPERATING_SPINE_ENABLED: 'true',
    VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: 'true', VITE_E2E_BYPASS_AUTH: 'false',
    VITE_PILOT_NOW_ENABLED: 'true', VITE_PILOT_EVENT_ROOM_ENABLED: 'true', VITE_PILOT_GUIDED_SELLING_ENABLED: 'true',
    VITE_PILOT_CREATE_ENABLED: 'true', VITE_PILOT_CHANGE_REQUESTS_ENABLED: 'true', VITE_PILOT_COMMAND_ENABLED: 'true',
    VITE_PILOT_MARGINS_ENABLED: 'true', VITE_PILOT_DECISION_ROOM_ENABLED: 'true',
    VITE_BUYER_ACCESS_ENABLED: 'false', VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: 'false'
  };
}
export function assertNoLocalProviderFiles(directory = root) {
  for (const name of ['.env', '.env.local', `.env.${REHEARSAL_PROJECT}`, '.secret.local']) {
    assert.equal(existsSync(path.join(directory, 'functions', name)), false, `Local rehearsal refuses Functions credential/config file ${name}; use the isolated checkout.`);
  }
}
export function assertRehearsalEmulators(env) {
  assert.equal(env.GCLOUD_PROJECT, REHEARSAL_PROJECT, 'Only the fixed disposable demo project is allowed.');
  assert.equal(env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9399');
  assert.equal(env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8383');
  assert.match(env.FIREBASE_EMULATOR_HUB || '', /^(?:127\.0\.0\.1|localhost):\d+$/);
}
async function run(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: false });
    let interrupted = false;
    const stop = () => { interrupted = true; child.kill('SIGINT'); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      if (interrupted || signal === 'SIGINT' || signal === 'SIGTERM') reject(Object.assign(new Error('Local rehearsal stopped.'), { rehearsalStopped: true }));
      else if (code === 0) resolve();
      else reject(new Error(`Local rehearsal child exited ${code}.`));
    });
  });
}
export async function main(args = process.argv.slice(2)) {
  assert.ok(args.length === 0 || args.length === 1 && args[0] === '--inside-emulators', 'Usage: node scripts/tenant-operating-model-local-rehearsal.mjs');
  assertNoLocalProviderFiles();
  const env = rehearsalEnvironment(process.env);
  if (!args.length) {
    const localConfig = mkdtempSync(path.join(os.tmpdir(), 'quotepilot-rehearsal-cloud-'));
    env.CLOUDSDK_CONFIG = localConfig; env.XDG_CONFIG_HOME = localConfig;
    // Emulator Admin SDK uses local mock credentials; hosted ADC must fail closed.
    env.GOOGLE_APPLICATION_CREDENTIALS = path.join(localConfig, 'provider-credentials-unavailable.json');
    console.log('Starting fresh synthetic rehearsal. No provider sends or hosted activation. Ctrl+C stops the app and emulators.');
    return run('npx', ['--no-install', 'firebase-tools', '--config', 'firebase.e2e.json', '--project', REHEARSAL_PROJECT,
      'emulators:exec', '--only', 'auth,firestore,functions', 'node scripts/tenant-operating-model-local-rehearsal.mjs --inside-emulators'], env);
  }
  assertRehearsalEmulators(env);
  const artifactDir = mkdtempSync(path.join(os.tmpdir(), 'quotepilot-local-rehearsal-'));
  await run(process.execPath, ['scripts/tenant-operating-model-local-rehearsal-seed.mjs', '--catalog-only'], env);
  await run(process.execPath, ['scripts/workflow-configuration-emulator-acceptance.mjs', '--evidence-output', path.join(artifactDir, 'acceptance.json')], env);
  await run(process.execPath, ['scripts/tenant-operating-model-local-rehearsal-seed.mjs'], env);
  const require = createRequire(import.meta.url);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  console.log(`Local source acceptance: ${path.join(artifactDir, 'acceptance.json')}`);
  await run(process.execPath, [vite, '--host', '127.0.0.1', '--port', '4174', '--strictPort'], env);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = error.rehearsalStopped ? 0 : 1; });
