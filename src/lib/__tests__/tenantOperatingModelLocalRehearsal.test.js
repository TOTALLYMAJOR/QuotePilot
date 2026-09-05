import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rehearsalEnvironment, assertRehearsalEmulators, assertNoLocalProviderFiles } from '../../../scripts/tenant-operating-model-local-rehearsal.mjs';

describe('synthetic local operating model rehearsal', () => {
  test('local rehearsal replaces hosted browser configuration and disables providers without bypassing auth', () => {
    const env = rehearsalEnvironment({ PATH: '/synthetic/bin', DEBUG: '*', GOOGLE_APPLICATION_CREDENTIALS: '/private/key.json', FIREBASE_TOKEN: 'synthetic', VITE_FIREBASE_PROJECT_ID: 'real-project', VITE_E2E_BYPASS_AUTH: 'true', VITE_UNKNOWN_REMOTE_ENDPOINT: 'https://invalid.test', NOTIFICATIONS_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic-provider', STRIPE_SECRET_KEY: 'synthetic-provider', TWILIO_AUTH_TOKEN: 'synthetic-provider', ARBITRARY_PRIVATE_KEY: 'synthetic-provider' });
    expect(env).toMatchObject({ PATH: '/synthetic/bin', GCLOUD_PROJECT: 'demo-workflow-configuration', VITE_FIREBASE_PROJECT_ID: 'demo-workflow-configuration', VITE_USE_FIREBASE_EMULATORS: 'true', VITE_E2E_BYPASS_AUTH: 'false', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1', NOTIFICATIONS_EMAIL_PROVIDER: 'none', NOTIFICATIONS_SMS_PROVIDER: 'none', REVENUE_AUTOPILOT_SENDS_ENABLED: 'false', VITE_EVENT_OPERATING_SPINE_ENABLED: 'true' });
    for (const name of ['DEBUG', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'VITE_UNKNOWN_REMOTE_ENDPOINT', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_AUTH_TOKEN', 'ARBITRARY_PRIVATE_KEY']) expect(env).not.toHaveProperty(name);
  });
  test('local rehearsal uses an unavailable credential path instead of inherited hosted ADC', () => {
    const env = rehearsalEnvironment({ CLOUDSDK_CONFIG: '/tmp/isolated-rehearsal', GOOGLE_APPLICATION_CREDENTIALS: '/private/real-key.json' });
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/tmp/isolated-rehearsal/provider-credentials-unavailable.json');
  });
  test('local rehearsal refuses Functions dotenv and secret files before emulator startup', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'rehearsal-config-test-'));
    try {
      mkdirSync(path.join(directory, 'functions'));
      expect(() => assertNoLocalProviderFiles(directory)).not.toThrow();
      writeFileSync(path.join(directory, 'functions', '.secret.local'), 'SYNTHETIC_PROVIDER_KEY=unusable');
      expect(() => assertNoLocalProviderFiles(directory)).toThrow(/credential\/config file/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test('local rehearsal seeding rejects hosted projects and nonlocal or mismatched emulator endpoints', () => {
    const valid = { GCLOUD_PROJECT: 'demo-workflow-configuration', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9399', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8383', FIREBASE_EMULATOR_HUB: '127.0.0.1:4400' };
    expect(() => assertRehearsalEmulators(valid)).not.toThrow();
    for (const mutation of [{ GCLOUD_PROJECT: 'production' }, { FIREBASE_AUTH_EMULATOR_HOST: 'remote.test:9399' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { FIREBASE_EMULATOR_HUB: 'remote.test:4400' }]) expect(() => assertRehearsalEmulators({ ...valid, ...mutation })).toThrow();
  });
});
