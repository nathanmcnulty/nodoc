import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { portalDiscoveryModelPolicy as policy } from './portal-discovery-model-policy.mjs';
import { sha256, createSourceReviewReceipt, validateSourceReview } from './source-review-receipt.mjs';

const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const bytes = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw new Error(message); };
const digestFile = p => sha256(fs.readFileSync(p));
const outputPath = p => path.join(fs.realpathSync(path.dirname(path.resolve(p))), path.basename(p)).toLowerCase();
const absent = p => { try { fs.lstatSync(p); fail(`Output already exists: ${p}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } fs.accessSync(path.dirname(path.resolve(p)), fs.constants.W_OK); };
const binding = (manifestPath, reviewPath) => {
  const m = json(manifestPath);
  if (!Array.isArray(m.changes)) fail('Invalid manifest');
  return { schemaVersion: 1, manifestSha256: digestFile(manifestPath), reviewSha256: digestFile(reviewPath), changes: m.changes.map(({destination,beforeSha256,proposalSha256}) => ({destination,beforeSha256,proposalSha256})) };
};
const expected = (manifestPath, reviewPath) => ({manifestSha256: digestFile(manifestPath), reviewSha256: digestFile(reviewPath), bindingSha256: sha256(bytes(binding(manifestPath, reviewPath)))});
const checkSol = (sol, hashes) => {
  if (sol.decision !== 'accept' || sol.model !== policy.orchestrator.model || sol.reasoning !== policy.orchestrator.reasoning || Object.entries(hashes).some(([k,v]) => sol[k] !== v)) fail('Invalid or mismatched Sol acceptance');
};
const checkReview = review => {
  if (review.model !== policy.offlineReview.model || !policy.offlineReview.allowedReasoning.includes(review.reasoning)) fail('Review does not match configured offline review role');
};
// Prepare hash values for the independent reviewer and orchestrator. This is not an acceptance.
export function prepare(manifestPath, reviewPath) { return expected(manifestPath, reviewPath); }
export function accept({root, manifestPath, reviewPath, solPath, bindingPath, gatePath}) {
  const hashes = expected(manifestPath, reviewPath);
  checkReview(json(reviewPath)); checkSol(json(solPath), hashes);
  const outputs = [bindingPath, gatePath].map(outputPath);
  const inputs = [manifestPath, reviewPath, solPath, ...json(manifestPath).changes.map(c => c.proposal)].map(p => path.resolve(p).toLowerCase());
  const rootPath = fs.realpathSync(root).toLowerCase();
  if (outputs[0] === outputs[1] || outputs.some(p => p === rootPath || p.startsWith(rootPath + path.sep) || inputs.includes(p))) fail('Unsafe output path');
  absent(bindingPath); absent(gatePath);
  createSourceReviewReceipt({root, manifestPath, reviewPath, receiptPath: bindingPath});
  validateSourceReview({root, manifestPath, reviewPath, receiptPath: bindingPath});
  const gate = { schemaVersion: 1, ...hashes, solAcceptanceSha256: digestFile(solPath), decision: 'accept', model: policy.orchestrator.model, reasoning: policy.orchestrator.reasoning };
  fs.writeFileSync(gatePath, bytes(gate), {flag:'wx'});
  return gate;
}
export function apply({root, manifestPath, reviewPath, solPath, bindingPath, gatePath, resultPath}) {
  const hashes = expected(manifestPath, reviewPath), sol = json(solPath), gate = json(gatePath);
  checkReview(json(reviewPath)); checkSol(sol, hashes); checkSol(gate, hashes);
  if (gate.schemaVersion !== 1 || gate.solAcceptanceSha256 !== digestFile(solPath) || digestFile(bindingPath) !== hashes.bindingSha256) fail('Gate or binding drift');
  const checked = validateSourceReview({root, manifestPath, reviewPath, receiptPath:bindingPath});
  // Receipts are external evidence, never a source file or any input path.
  const out = outputPath(resultPath), rootPath = fs.realpathSync(root).toLowerCase();
  if (out === rootPath || out.startsWith(rootPath + path.sep) || [manifestPath,reviewPath,solPath,bindingPath,gatePath].some(p => path.resolve(p).toLowerCase() === out.toLowerCase())) fail('Unsafe result path');
  absent(resultPath);
  const result = {schemaVersion:1, status:'applying', ...hashes, gateSha256:digestFile(gatePath), completed:[], pending:null};
  // Create before writes; pending marks the write whose completion may be uncertain after an interruption.
  const fd = fs.openSync(resultPath, 'wx');
  try { fs.writeFileSync(fd, bytes(result)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const save = () => {
    const temp = `${resultPath}.${randomUUID()}.tmp`;
    let tempFd, created = false;
    try {
      tempFd = fs.openSync(temp, 'wx'); created = true;
      fs.writeFileSync(tempFd, bytes(result)); fs.fsyncSync(tempFd);
      fs.closeSync(tempFd); tempFd = undefined;
      fs.renameSync(temp, resultPath); created = false;
    } finally {
      if (tempFd !== undefined) fs.closeSync(tempFd);
      if (created) fs.unlinkSync(temp);
    }
  };
  try {
    save();
    for (const entry of checked.prepared) {
      // Repeat the complete check before each write and use the preflighted bytes, stopping on drift.
      validateSourceReview({root, manifestPath, reviewPath, receiptPath:bindingPath, completed:result.completed});
      result.pending = entry.item.destination; save();
      fs.writeFileSync(entry.destination, entry.bytes, {flag: entry.item.beforeSha256 === null ? 'wx' : 'w'});
      result.completed.push(entry.item.destination); result.pending = null; save();
    }
    result.status = 'applied'; save(); return result;
  } catch (error) {
    result.status = 'failed-or-interrupted';
    try { save(); } catch { /* last durable pending entry remains the uncertainty marker */ }
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare' && args.length === 2) console.log(JSON.stringify(prepare(...args)));
  else if (command === 'accept' && args.length === 6) console.log(JSON.stringify(accept(Object.fromEntries(['root','manifestPath','reviewPath','solPath','bindingPath','gatePath'].map((k,i)=>[k,args[i]])))));
  else if (command === 'apply' && args.length === 7) console.log(JSON.stringify(apply(Object.fromEntries(['root','manifestPath','reviewPath','solPath','bindingPath','gatePath','resultPath'].map((k,i)=>[k,args[i]])))));
  else fail('Usage: prepare MANIFEST REVIEW | accept ROOT MANIFEST REVIEW SOL BINDING GATE | apply ROOT MANIFEST REVIEW SOL BINDING GATE RESULT');
}
