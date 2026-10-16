import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildVisualEvidenceBundle } from '../build-visual-evidence-bundle.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-visual-test-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  fs.writeFileSync(path.join(root, '.gitignore'), '.cache/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture');
  fs.mkdirSync(path.join(root, '.cache/playwright-evidence/captures'), { recursive: true });
  const report = { stats: { startTime: new Date(Date.now() - 1000).toISOString(), duration: 2000, expected: 3, skipped: 0, unexpected: 0, flaky: 0 }, errors: [] };
  fs.writeFileSync(path.join(root, '.cache/playwright-evidence/results.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(root, '.cache/playwright-evidence/captures/current.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  return { root, report, git, sha: git('rev-parse', 'HEAD') };
}
function build(f, options = {}) { return buildVisualEvidenceBundle({ repositoryRoot: f.root, env: {}, ...options }); }
function report(f, changes) { fs.writeFileSync(path.join(f.root, '.cache/playwright-evidence/results.json'), JSON.stringify({ ...f.report, ...changes })); }

test('retains exact SHA, report and image bytes with digests without stronger proof', () => {
  const f = fixture();
  const result = build(f, { env: { GITHUB_ACTIONS: 'true', GITHUB_SHA: f.sha, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' } });
  assert.equal(result.manifest.checkoutSha, f.sha);
  assert.equal(result.manifest.evidenceClass, 'ci');
  assert.equal(result.manifest.screenshotCount, 1);
  assert.equal(result.manifest.captures[0].stage, 'current');
  const bytes = fs.readFileSync(path.join(result.output, result.manifest.captures[0].bundledPath));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), result.manifest.captures[0].sha256);
  const manifestBytes = fs.readFileSync(path.join(result.output, 'manifest.json'));
  assert.equal(fs.readFileSync(path.join(result.output, 'manifest.sha256'), 'utf8').split(' ')[0], createHash('sha256').update(manifestBytes).digest('hex'));
  assert.ok(result.manifest.boundary.doesNotProve.includes('human visual acceptance'));
});
test('rejects a mismatched checkout SHA before creating output', () => {
  const f = fixture();
  assert.throws(() => build(f, { env: { GITHUB_SHA: '0'.repeat(40) } }), /checkout SHA/);
  assert.equal(fs.existsSync(path.join(f.root, '.cache/visual-evidence')), false);
});
test('rejects dirty tracked source', () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.root, '.gitignore'), 'extra\n');
  assert.throws(() => build(f), /clean checkout/);
});
for (const changes of [{ expected: 0 }, { skipped: 1 }, { unexpected: 1 }, { flaky: 1 }, { expected: '3' }]) {
  test(`rejects incomplete or invalid cohort ${JSON.stringify(changes)}`, () => {
    const f = fixture(); report(f, { stats: { ...f.report.stats, ...changes } });
    assert.throws(() => build(f), /successful complete/);
  });
}
test('rejects report errors even with passing stats', () => {
  const f = fixture(); report(f, { errors: [{ message: 'worker died' }] });
  assert.throws(() => build(f), /successful complete/);
});
test('rejects empty capture sets and stale screenshots', () => {
  const f = fixture();
  const file = path.join(f.root, '.cache/playwright-evidence/captures/current.png');
  fs.utimesSync(file, new Date(0), new Date(0));
  assert.throws(() => build(f), /outside the report run/);
  fs.unlinkSync(file);
  assert.throws(() => build(f), /No screenshot/);
});
test('refuses outside paths, symlinks, and overwrite without deleting anything', () => {
  const f = fixture();
  for (const outputRoot of ['.', '..', '../outside', '.git', '/tmp']) assert.throws(() => build(f, { outputRoot }), /generated path/);
  fs.symlinkSync(path.join(f.root, '.gitignore'), path.join(f.root, '.cache/playwright-evidence/captures/linked.png'));
  assert.throws(() => build(f), /symlink/);
  fs.unlinkSync(path.join(f.root, '.cache/playwright-evidence/captures/linked.png'));
  const result = build(f);
  assert.throws(() => build(f), /already exists/);
  assert.equal(fs.existsSync(path.join(result.output, 'manifest.json')), true);
});
