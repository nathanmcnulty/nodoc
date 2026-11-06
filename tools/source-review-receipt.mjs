import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new Error(message); };

// Reject links in every existing component, including the workspace root itself.
function noLinks(target) {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`Link in path: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// This validator is used both to accept and immediately before applying a proposal.
export function validateSourceReview({ root, manifestPath, reviewPath, receiptPath, completed = [] }) {
  root = path.resolve(root);
  noLinks(root);
  if (!fs.statSync(root).isDirectory()) fail('Workspace root must be a directory');
  const manifestBytes = fs.readFileSync(manifestPath), reviewBytes = fs.readFileSync(reviewPath);
  const manifest = readJson(manifestPath), review = readJson(reviewPath), receipt = readJson(receiptPath);
  const manifestSha256 = sha256(manifestBytes), reviewSha256 = sha256(reviewBytes);
  if (review.decision !== 'accepted' || review.reviewedManifestSha256 !== manifestSha256)
    fail('Independent review must accept the exact manifest hash');
  if (receipt.schemaVersion !== 1 || receipt.manifestSha256 !== manifestSha256 || receipt.reviewSha256 !== reviewSha256 || !Array.isArray(receipt.changes))
    fail('Receipt does not bind exact manifest and review bytes');
  if (!Array.isArray(manifest.changes) || !manifest.changes.length || receipt.changes.length !== manifest.changes.length) fail('No changes or receipt count mismatch');
  const seen = new Set(), prepared = [];
  for (const [i, item] of manifest.changes.entries()) {
    if (!item || typeof item.destination !== 'string' || !item.destination || path.isAbsolute(item.destination) || item.destination.includes('\\') || item.destination.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':') || /[<>\"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p)))
      fail('Unsafe destination');
    const destination = path.resolve(root, ...item.destination.split('/'));
    if (!destination.startsWith(root + path.sep) || path.basename(destination).toLowerCase() === 'next.md') fail('Disallowed destination');
    const key = destination.toLowerCase();
    if (seen.has(key)) fail('Duplicate destination');
    seen.add(key);
    if (typeof item.proposal !== 'string' || !path.isAbsolute(item.proposal) || !digest(item.proposalSha256) || !(item.beforeSha256 === null || digest(item.beforeSha256))) fail('Invalid change hashes or proposal path');
    const triple = receipt.changes[i];
    if (!triple || triple.destination !== item.destination || triple.beforeSha256 !== item.beforeSha256 || triple.proposalSha256 !== item.proposalSha256) fail('Receipt change mismatch');
    noLinks(destination); noLinks(path.resolve(item.proposal));
    const bytes = fs.readFileSync(item.proposal);
    if (sha256(bytes) !== item.proposalSha256) fail('Proposal drift');
    let stat;
    try { stat = fs.lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const expectedBefore = completed.includes(item.destination) ? item.proposalSha256 : item.beforeSha256;
    if (expectedBefore === null ? !!stat : !stat || !stat.isFile() || sha256(fs.readFileSync(destination)) !== expectedBefore) fail('Destination drift');
    if (!fs.statSync(path.dirname(destination)).isDirectory()) fail('Destination parent missing');
    prepared.push({ destination, bytes, item });
  }
  return { manifest, manifestSha256, reviewSha256, prepared };
}

// Reviewers must explicitly accept the exact manifest hash. This does not create a review.
export function createSourceReviewReceipt({ root, manifestPath, reviewPath, receiptPath }) {
  const manifestBytes = fs.readFileSync(manifestPath), reviewBytes = fs.readFileSync(reviewPath);
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.changes)) fail('Invalid manifest');
  const receipt = { schemaVersion: 1, manifestSha256: sha256(manifestBytes), reviewSha256: sha256(reviewBytes), changes: manifest.changes.map(({ destination, beforeSha256, proposalSha256 }) => ({ destination, beforeSha256, proposalSha256 })) };
  // Validate using a temporary receipt created exclusively, before publishing the receipt.
  const temp = `${receiptPath}.${process.pid}.${cryptoRandom()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    validateSourceReview({ root, manifestPath, reviewPath, receiptPath: temp });
    fs.copyFileSync(temp, receiptPath, fs.constants.COPYFILE_EXCL);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return receipt;
}
function cryptoRandom() { return Math.random().toString(36).slice(2); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, manifestPath, reviewPath, receiptPath] = process.argv.slice(2);
  if (!root || !manifestPath || !reviewPath || !receiptPath) fail('Usage: node source-review-receipt.mjs ROOT MANIFEST REVIEW RECEIPT');
  createSourceReviewReceipt({ root, manifestPath, reviewPath, receiptPath });
}
