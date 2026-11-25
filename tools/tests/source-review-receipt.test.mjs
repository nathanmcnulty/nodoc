import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256, createSourceReviewReceipt, validateSourceReview } from '../source-review-receipt.mjs';

test('binding generation and both gates reject drift and unsafe input', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nodoc-review-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'); fs.mkdirSync(root);
  const dest = path.join(root, 'a.yml'), proposal = path.join(base, 'proposal');
  const manifestPath = path.join(base, 'manifest.json'), reviewPath = path.join(base, 'review.json'), receiptPath = path.join(base, 'receipt.json');
  fs.writeFileSync(dest, 'old'); fs.writeFileSync(proposal, 'new');
  const manifest = { changes: [{ destination: 'a.yml', proposal, beforeSha256: sha256('old'), proposalSha256: sha256('new') }] };
  const put = () => { fs.writeFileSync(manifestPath, JSON.stringify(manifest)); fs.writeFileSync(reviewPath, JSON.stringify({ decision: 'accepted', reviewedManifestSha256: sha256(fs.readFileSync(manifestPath)) })); };
  const args = { root, manifestPath, reviewPath, receiptPath };
  put(); createSourceReviewReceipt(args); assert.equal(validateSourceReview(args).prepared.length, 1);
  assert.throws(() => createSourceReviewReceipt(args));
  fs.writeFileSync(dest, 'drift'); assert.throws(() => validateSourceReview(args), /drift/); fs.writeFileSync(dest, 'old');
  fs.writeFileSync(proposal, 'drift'); assert.throws(() => validateSourceReview(args), /drift/); fs.writeFileSync(proposal, 'new');
  fs.writeFileSync(reviewPath, JSON.stringify({ decision: 'accepted', reviewedManifestSha256: '0'.repeat(64) })); assert.throws(() => validateSourceReview(args), /exact manifest/);
  put(); const receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.changes[0].proposalSha256 = '0'.repeat(64); fs.writeFileSync(receiptPath, JSON.stringify(receipt)); assert.throws(() => validateSourceReview(args), /mismatch/);
  for (const bad of ['../escape', 'NEXT.md', 'foo/../a.yml', 'a.yml:stream']) {
    manifest.changes[0].destination = bad; put(); fs.rmSync(receiptPath, { force: true }); assert.throws(() => createSourceReviewReceipt(args), /destination/i);
  }
  manifest.changes[0].destination = 'a.yml'; manifest.changes[0].beforeSha256 = 'a'.repeat(63); put(); assert.throws(() => createSourceReviewReceipt(args), /hashes/);
});

test('preflights every change and supports new files', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nodoc-review-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'); fs.mkdirSync(root); const p = path.join(base, 'p'); fs.writeFileSync(p, 'new');
  const manifestPath = path.join(base, 'm'), reviewPath = path.join(base, 'r'), receiptPath = path.join(base, 'binding');
  const m = { changes: ['one', 'two'].map(destination => ({ destination, proposal: p, beforeSha256: null, proposalSha256: sha256('new') })) };
  fs.writeFileSync(manifestPath, JSON.stringify(m)); fs.writeFileSync(reviewPath, JSON.stringify({ decision: 'accepted', reviewedManifestSha256: sha256(fs.readFileSync(manifestPath)) }));
  const args = { root, manifestPath, reviewPath, receiptPath }; createSourceReviewReceipt(args);
  fs.writeFileSync(path.join(root, 'two'), 'unexpected'); assert.throws(() => validateSourceReview(args), /drift/); assert.equal(fs.existsSync(path.join(root, 'one')), false);
});
