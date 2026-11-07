import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { isDeepStrictEqual } from "node:util";
import { repoRoot, buildSpecRouteInventory, loadBundledSpecification } from "./spec-quality-lib.mjs";
import { portalDiscoveryModelPolicy } from "./portal-discovery-model-policy.mjs";
import { privateRefreshDirectory, assertNoRefreshLinks } from "./portal-refresh-paths.mjs";
import { validateSourceReview } from "./source-review-receipt.mjs";
import { loadVerifiedRefreshAnalysis, refreshAnalysisDigest } from "./portal-refresh.mjs";
import { refreshSourceState } from "./portal-refresh-binding.mjs";
import { validateManagedCaptureResult } from "./portal-discovery-control-plane.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const pointerParts = fragment => fragment.replace(/^#\/?/u, "").split("/").filter(Boolean).map(part => decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~"));
const exampleFor = entry => ({ summary: "Synthetic values illustrating an observed response shape; not a captured response.",
  description: `Based on passive portal observation ${entry.observedAt}, evidence ${entry.evidenceId}. Scalar values are synthesized; this example illustrates one observed shape.`, value: entry.syntheticExample });

const privatePropertyName = key => !["@odata.context", "@odata.type", "@odata.id", "@odata.etag", "@odata.nextLink", "@odata.count", "@odata.deltaLink"].includes(key) && /[@\\/]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:$|:)/iu.test(key)
  || ["__proto__", "constructor", "prototype"].includes(key);
function privateExampleNames(value) {
  if (Array.isArray(value)) return value.some(privateExampleNames);
  return value !== null && typeof value === "object" && Object.entries(value).some(([key, item]) => privatePropertyName(key) || privateExampleNames(item));
}
function privateSchemaNames(schema) {
  if (!schema || typeof schema !== "object") return false;
  return Object.entries(schema.properties ?? {}).some(([key, item]) => privatePropertyName(key) || privateSchemaNames(item))
    || privateSchemaNames(schema.items) || ["anyOf", "oneOf", "allOf"].some(key => (schema[key] ?? []).some(privateSchemaNames));
}
function hasSchemaProperties(schema) {
  return Boolean(schema && (Object.keys(schema.properties ?? {}).length || hasSchemaProperties(schema.items)));
}

function markMediaEdit(target, keys, original) {
  const node = original.document.getIn(keys);
  if (!node?.range || !YAML.isMap(node) || node.anchor) { target.fullRenderRequired = true; return; }
  target.mediaEdits ??= new Map();
  const start = node.range[0], end = node.range[2];
  const lineStart = original.bytes.lastIndexOf("\n", start - 1) + 1;
  const indent = original.bytes.slice(lineStart, start);
  if (!/^ *$/u.test(indent)) { target.fullRenderRequired = true; return; }
  target.mediaEdits.set(JSON.stringify(keys), { keys, start, end, indent });
}

function renderProposal(source) {
  let bytes = source.bytes;
  if (source.fullRenderRequired || !source.mediaEdits?.size) return source.document.toString({ lineWidth: 0 });
  let previousStart = Infinity;
  for (const edit of [...source.mediaEdits.values()].sort((a, b) => b.start - a.start)) {
    if (edit.end > previousStart) throw new Error("Overlapping YAML edit ranges need manual source review.");
    const fragment = new YAML.Document();
    fragment.contents = source.document.getIn(edit.keys);
    const text = fragment.toString({ lineWidth: 0 }).split("\n").map((line, index) => index && line ? edit.indent + line : line).join("\n");
    bytes = bytes.slice(0, edit.start) + text + bytes.slice(edit.end);
    previousStart = edit.start;
  }
  if (!isDeepStrictEqual(YAML.parse(bytes), source.document.toJSON())) throw new Error("Focused YAML rendering changed unrelated semantics.");
  return bytes;
}

async function sourceNode(filename, keys, seen = new Set()) {
  filename = path.resolve(filename);
  const relative = path.relative(path.join(repoRoot, "specifications"), filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Proposal reference escapes specifications.");
  await assertNoRefreshLinks(filename);
  const identity = `${filename}#${JSON.stringify(keys)}`;
  if (seen.has(identity)) throw new Error("Circular proposal reference.");
  seen.add(identity);
  const bytes = await readFile(filename, "utf8"), document = YAML.parseDocument(bytes);
  if (document.errors.length) throw new Error("Invalid proposal source YAML.");
  for (let count = 0; count <= keys.length; count++) {
    const prefix = keys.slice(0, count), node = document.getIn(prefix);
    if (YAML.isMap(node) && typeof node.get("$ref") === "string") {
      if (node.items.length !== 1) throw new Error("Reference siblings require manual source review.");
      const [file, fragment = ""] = node.get("$ref").split("#");
      if (/^[a-z]+:/iu.test(file)) throw new Error("Remote proposal references are not supported.");
      return sourceNode(path.resolve(path.dirname(filename), file || path.basename(filename)), [...pointerParts(fragment), ...keys.slice(count)], seen);
    }
  }
  return { filename, bytes, document, keys };
}

// Produces full source proposals for the existing prepare/accept/apply workflow.
// Every proposal remains private until that independent evidence/privacy review.
export async function prepareRefreshProposals({ analysis, selections = [], outputDir, inventory, captureDirectory = analysis?.artifactDirectory }) {
  if (!captureDirectory) throw new Error("The immutable capture directory must be bound before proposing source changes.");
  const captureRoot = await privateRefreshDirectory(captureDirectory);
  outputDir = await privateRefreshDirectory(outputDir, { create: true, readOnlyRoots: [captureRoot] });
  const files = new Map(), evidence = [];
  const seen = new Set();
  for (const selection of selections) {
    const newOperation = selection.kind === "new-operation";
    const candidates = (newOperation ? analysis.discoveryDrafts ?? [] : analysis.enrichments).filter(entry => entry.evidenceId === selection.evidenceId && entry.specId === selection.specId);
    if (candidates.length !== 1) throw new Error("Selection must identify one exact enrichment observation.");
    const entry = candidates[0];
    if (privateExampleNames(entry.syntheticExample) || privateSchemaNames(entry.schema)) throw new Error("Identifier-like property names require manual privacy-safe dictionary modeling before proposal generation.");
    if (!newOperation && !["schema-missing", "compatible-observed-types"].includes(entry.comparison)) throw new Error("Changed or unsupported contracts need manual reconciliation.");
    if (!analysis.captureComplete || !Number.isInteger(entry.actionIndex) || entry.actionIndex < 0) throw new Error("Proposal requires complete attributed capture evidence.");
    if (!entry.evidenceId || !entry.captureId || !Number.isFinite(Date.parse(entry.observedAt))) throw new Error("Proposal requires original observation date and evidence identity.");
    const spec = inventory.find(item => item.specId === entry.specId);
    if (!spec) throw new Error("Unknown proposal destination.");
    if (newOperation) {
      if (selection.ownershipConfirmed !== true || entry.method !== "GET" || !entry.path.startsWith("/") || !entry.serverUrl) throw new Error("Discovery drafts require explicit ownership review and an observed GET server binding.");
      const source = await sourceNode(path.join(repoRoot, spec.specPath), ["paths", entry.path, "get"]);
      const destination = path.relative(repoRoot, source.filename).replaceAll("\\", "/");
      let target = files.get(destination);
      if (!target) { target = source; files.set(destination, target); }
      target.fullRenderRequired = true;
      const identity = `${destination}:${JSON.stringify(source.keys)}`;
      if (seen.has(identity) || target.document.getIn(source.keys) !== undefined) throw new Error("Discovery proposal would overwrite existing data.");
      seen.add(identity);
      const parameterNames = [...entry.path.matchAll(/\{([^{}]+)\}/gu)].map(match => match[1]);
      target.document.setIn(source.keys, { operationId: `observedGet${hash(`${entry.specId}:${entry.path}`).slice(0, 12)}`,
        summary: "Observed portal read", description: `Observed passive portal response on ${entry.observedAt ?? "an unrecorded date"}; evidence ${entry.evidenceId}. The optional model describes observed JSON types only. Requiredness, minimum roles and standalone execution remain unproved.`,
        servers: [{ url: entry.serverUrl, description: "Existing public server template matched to the observed portal request." }],
        ...(parameterNames.length ? { parameters: [...new Set(parameterNames)].map(name => ({ name, in: "path", required: true, schema: { type: "string" } })) } : {}),
        responses: { [entry.status]: { description: "Observed complete successful response.", content: { [entry.mimeType]: { schema: entry.schema,
          examples: { syntheticRefresh: { summary: "Synthetic values illustrating one observed shape; not a captured response.", value: entry.syntheticExample } } } } } } });
      evidence.push({ destination, kind: selection.kind, specId: entry.specId, method: entry.method, path: entry.path, status: entry.status, mimeType: entry.mimeType,
        captureId: entry.captureId, evidenceId: entry.evidenceId, actionIndex: entry.actionIndex, observedAt: entry.observedAt });
      continue;
    }
    const schemaMode = selection.kind === "response-schema";
    if (!schemaMode && selection.kind !== "synthetic-example") throw new Error("Only response-schema and synthetic-example proposals are supported; discovery operations require ownership review.");
    if (schemaMode && entry.comparison !== "schema-missing") throw new Error("Existing schemas are never overwritten by refresh inference.");
    const variants = analysis.enrichments.filter(item => item.specId === entry.specId && item.method === entry.method && item.path === entry.path && item.status === entry.status && item.mimeType === entry.mimeType);
    if (schemaMode && new Set(variants.map(item => JSON.stringify(item.schema))).size > 1) throw new Error("Multiple observed response shapes require manual reconciliation.");
    const keys = ["paths", entry.path, entry.method.toLowerCase(), "responses", entry.status, "content", entry.mimeType];
    const source = await sourceNode(path.join(repoRoot, spec.specPath), keys);
    if (source.keys[0] !== "paths" || source.keys[1] !== entry.path || source.keys[2] !== entry.method.toLowerCase()) throw new Error("Shared components and aliased operations require manual contract reconciliation.");
    const destination = path.relative(repoRoot, source.filename).replaceAll("\\", "/");
    let target = files.get(destination);
    if (!target) { target = source; files.set(destination, target); }
    markMediaEdit(target, source.keys, source);
    const key = schemaMode ? [...source.keys, "schema"] : [...source.keys, "examples", "syntheticRefresh"];
    const identity = `${destination}:${JSON.stringify(key)}`;
    if (seen.has(identity)) throw new Error("Overlapping refresh proposal selection.");
    seen.add(identity);
    const current = target.document.getIn(key);
    if (current !== undefined && !(schemaMode && YAML.isMap(current) && current.items.length === 0)) throw new Error("Refresh proposal would overwrite existing data.");
    const responseKeys = source.keys.slice(0, -2);
    if (target.document.getIn(responseKeys) === undefined) target.document.setIn([...responseKeys, "description"], "Observed successful response.");
    target.document.setIn(key, schemaMode ? entry.schema : exampleFor(entry));
    evidence.push({ destination, kind: selection.kind, specId: entry.specId, method: entry.method, path: entry.path, status: entry.status, mimeType: entry.mimeType,
      captureId: entry.captureId, evidenceId: entry.evidenceId, actionIndex: entry.actionIndex, observedAt: entry.observedAt,
      ...(entry.supportingObservations ? { supportingObservations: entry.supportingObservations } : {}) });
  }
  const changes = [];
  for (const [destination, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const proposal = path.join(outputDir, `${hash(destination).slice(0, 16)}.yml`);
    await assertNoRefreshLinks(proposal);
    const bytes = renderProposal(source);
    if (!editsWithinTargets(source.bytes, bytes, evidence.filter(item => item.destination === destination).map(editTarget))) {
      throw new Error("Shared YAML aliases or unrelated semantic edits require manual reconciliation.");
    }
    await writeFile(proposal, bytes, { flag: "wx" });
    changes.push({ destination, beforeSha256: hash(source.bytes), beforeSource: source.bytes, proposalSha256: hash(bytes), proposal });
  }
  const manifest = { schemaVersion: 1, visibility: "private-evidence-only", captureId: analysis.captureId, analysisDigest: refreshAnalysisDigest(analysis), changes, evidence,
    requiresIndependentPrivacyReview: true, rawResponseValuesIncluded: false, syntheticScalarExamplesOnly: true };
  await assertNoRefreshLinks(path.join(outputDir, "manifest.json"));
  await writeFile(path.join(outputDir, "manifest.json"), json(manifest), { flag: "wx" });
  return manifest;
}

function additionsOnly(before, after, pointer = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [{ pointer, kind: "replacement" }];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => !Object.hasOwn(after, key) ? [{ pointer: [...pointer, key], kind: "removal" }]
    : !Object.hasOwn(before, key) ? [{ pointer: [...pointer, key], kind: "addition", value: after[key] }] : additionsOnly(before[key], after[key], [...pointer, key]));
}

function editTarget(item) {
  const operation = ["paths", item.path, item.method.toLowerCase()];
  if (item.kind === "new-operation") return operation;
  const media = [...operation, "responses", String(item.status), "content", item.mimeType];
  return item.kind === "response-schema" ? [...media, "schema"] : [...media, "examples", "syntheticRefresh"];
}

function editsWithinTargets(before, proposed, targets) {
  const prefix = (left, right) => left.length <= right.length && left.every((part, index) => part === right[index]);
  // Check expanded semantics as well as the authored YAML target: aliases can
  // otherwise mutate a second operation without a second observation.
  return additionsOnly(YAML.parse(before), YAML.parse(proposed)).every(({ pointer }) =>
    targets.some(target => prefix(target, pointer) || prefix(pointer, target)));
}

const requiredChecks = ["discovery", "spec-quality", "portal-metadata", "evaluations", "graph-research", "site-data", "postman-parity", "typecheck", "build", "privacy"];
function narrowSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  if (Object.keys(schema).some(key => !["type", "properties", "items", "nullable"].includes(key))) return false;
  if (schema.type !== undefined && !["object", "array", "string", "integer", "number", "boolean"].includes(schema.type)) return false;
  if (schema.nullable !== undefined && schema.nullable !== true) return false;
  if (schema.properties && !Object.values(schema.properties).every(narrowSchema)) return false;
  if (schema.items && !narrowSchema(schema.items)) return false;
  return true;
}
function syntheticValuesOnly(value) {
  if (value === null || value === false || value === 0 || value === 0.5 || value === "example") return true;
  if (Array.isArray(value)) return value.every(syntheticValuesOnly);
  return value && typeof value === "object" && Object.values(value).every(syntheticValuesOnly);
}

// Synthetic scalar values do not sanitize dictionary keys. Automatic eligibility
// requires every example key, at its exact nesting level, in the authored model.
// additionalProperties/composition cannot establish a public property-name set.
function authoredExampleNames(value, schema) {
  if (Array.isArray(value)) return value.every(item => authoredExampleNames(item, schema?.items));
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, item]) => Object.hasOwn(schema?.properties ?? {}, key)
    && !privatePropertyName(key)
    && authoredExampleNames(item, schema.properties[key]));
}

async function bindProposedEdits({ entry, before, proposed, evidence, analysis, inventory }) {
  const blockers = [], expected = YAML.parseDocument(before), seen = new Set(), targets = [];
  if (!analysis || !evidence.length) return ["edit-evidence-binding-incomplete"];
  for (const item of evidence) {
    const observation = analysis.enrichments.find(candidate => candidate.specId === item.specId && candidate.evidenceId === item.evidenceId);
    const fields = ["specId", "method", "path", "status", "mimeType", "captureId", "evidenceId", "actionIndex", "observedAt", "supportingObservations"];
    if (!observation || fields.some(key => !isDeepStrictEqual(item[key], observation[key]))) {
      blockers.push("edit-evidence-does-not-match-verified-observation"); continue;
    }
    if (!["synthetic-example", "response-schema"].includes(item.kind) || !["schema-missing", "compatible-observed-types"].includes(observation.comparison)) {
      blockers.push("edit-kind-or-contract-requires-review"); continue;
    }
    const spec = inventory.find(candidate => candidate.specId === item.specId);
    const mediaKeys = ["paths", item.path, item.method.toLowerCase(), "responses", item.status, "content", item.mimeType];
    let owner;
    try { owner = spec && await sourceNode(path.join(repoRoot, spec.specPath), mediaKeys); }
    catch { /* Unsupported ownership cannot authorize an edit. */ }
    if (!owner || path.relative(repoRoot, owner.filename).replaceAll("\\", "/") !== entry.destination || !isDeepStrictEqual(owner.keys, mediaKeys)) {
      blockers.push("edit-operation-owner-does-not-match-evidence"); continue;
    }
    const schemaMode = item.kind === "response-schema";
    const keys = schemaMode ? [...mediaKeys, "schema"] : [...mediaKeys, "examples", "syntheticRefresh"];
    const identity = JSON.stringify(keys), current = expected.getIn(keys);
    if (seen.has(identity) || current !== undefined && !(schemaMode && YAML.isMap(current) && current.items.length === 0)) {
      blockers.push("edit-overwrites-existing-or-duplicate-data"); continue;
    }
    seen.add(identity);
    targets.push(keys);
    if (schemaMode && observation.comparison !== "schema-missing") blockers.push("edit-kind-or-contract-requires-review");
    if (schemaMode && new Set(analysis.enrichments.filter(candidate => ["specId", "method", "path", "status", "mimeType"].every(key => candidate[key] === observation[key])).map(candidate => json(candidate.schema))).size > 1) blockers.push("conflicting-observed-shapes-require-review");
    if (schemaMode && hasSchemaProperties(observation.schema)) blockers.push("new-schema-property-names-require-review");
    if (!schemaMode) {
      const bundled = await loadBundledSpecification(path.join(repoRoot, spec.specPath));
      // Read the original schema when the proposal adds a schema in this file.
      // Otherwise the current bundle is safe: this edit may only add an example.
      const authored = YAML.parse(before).paths?.[item.path]?.[item.method.toLowerCase()]?.responses?.[item.status]?.content?.[item.mimeType]?.schema;
      const schema = authored?.$ref ? bundled.paths?.[item.path]?.[item.method.toLowerCase()]?.responses?.[item.status]?.content?.[item.mimeType]?.schema : authored;
      if (!authoredExampleNames(observation.syntheticExample, schema)) blockers.push("example-property-names-require-review");
    }
    if (privateExampleNames(observation.syntheticExample) || privateSchemaNames(observation.schema)) blockers.push("identifier-like-property-names-require-review");
    const responseKeys = mediaKeys.slice(0, -2);
    if (expected.getIn(responseKeys) === undefined) expected.setIn([...responseKeys, "description"], "Observed successful response.");
    expected.setIn(keys, schemaMode ? observation.schema : exampleFor(observation));
  }
  if (!isDeepStrictEqual(expected.toJSON(), YAML.parse(proposed))) blockers.push("proposed-edits-do-not-match-verified-evidence");
  if (!editsWithinTargets(before, proposed, targets)) blockers.push("semantic-edit-outside-verified-target");
  return [...new Set(blockers)];
}

// Advisory only. Neither this function nor the controller can merge or enable merging.
export async function reportRefreshMergeEligibility({ manifest, review = null, checks = null, sourceRevision = null, sourceReview = null, proposalRoot = null, analysisPath = null, captureIdentityEvidence = null }) {
  const manifestDigest = hash(json(manifest));
  const reasons = [];
  let analysis = null;
  const actualSource = await refreshSourceState();
  if (sourceRevision !== actualSource.sourceRevision || checks?.sourceRevision !== actualSource.sourceRevision || checks?.sourceStateDigest !== actualSource.sourceStateDigest) reasons.push("checks-not-bound-to-actual-source-state");
  if (!analysisPath) reasons.push("verified-current-analysis-required");
  else {
    try {
      analysis = await loadVerifiedRefreshAnalysis(analysisPath, { baselineChanges: manifest.changes ?? [] });
      if (refreshAnalysisDigest(analysis) !== manifest.analysisDigest || analysis.captureId !== manifest.captureId) throw new Error("Analysis mismatch.");
    } catch { analysis = null; reasons.push("current-analysis-or-capture-binding-invalid"); }
  }
  try {
    if (!analysis || !captureIdentityEvidence) throw new Error("Managed capture evidence is required.");
    const accepted = await validateManagedCaptureResult({
      resultPath: captureIdentityEvidence.resultPath, planPath: captureIdentityEvidence.planPath,
      packetPath: captureIdentityEvidence.packetPath, ledgerPath: captureIdentityEvidence.ledgerPath,
      runPath: path.join(analysis.artifactDirectory, "discovery-run.json"),
    });
    if (accepted.status !== "completed" || accepted.decision !== "accept") throw new Error("Managed capture is not accepted and complete.");
  } catch {
    // Never expose private paths, variables, response facts or parser diagnostics.
    reasons.push("capture-controller-identity-unproved");
  }
  if (manifest.visibility !== "private-evidence-only" || manifest.rawResponseValuesIncluded !== false || manifest.syntheticScalarExamplesOnly !== true || manifest.requiresIndependentPrivacyReview !== true) reasons.push("proposal-privacy-contract-invalid");
  if (!sourceReview) reasons.push("validated-source-review-receipt-required");
  else {
    try {
      const bound = JSON.parse(await readFile(sourceReview.manifestPath, "utf8"));
      if (hash(json(bound)) !== manifestDigest) throw new Error("Manifest mismatch.");
      const completed = [];
      for (const entry of manifest.changes ?? []) if (hash(await readFile(path.join(repoRoot, entry.destination))) === entry.proposalSha256) completed.push(entry.destination);
      const checked = validateSourceReview({ ...sourceReview, root: repoRoot, completed });
      const boundReview = JSON.parse(await readFile(sourceReview.reviewPath, "utf8"));
      if (checked.manifestSha256 !== manifestDigest || !isDeepStrictEqual(review, boundReview)) throw new Error("Review mismatch.");
    } catch { reasons.push("source-review-receipt-invalid-or-stale"); }
  }
  if (!manifest.changes?.length) reasons.push("no-proposed-source-changes");
  if (!sourceRevision || checks?.sourceRevision !== sourceRevision || checks?.manifestDigest !== manifestDigest) reasons.push("checks-not-bound-to-current-revision-and-proposals");
  for (const name of requiredChecks) if (checks?.results?.[name]?.exitCode !== 0 || checks.results[name].observed !== true) reasons.push(`check-unproved:${name}`);
  if (review?.decision !== "accepted" || review?.reviewedManifestSha256 !== manifestDigest || review?.sanitized !== true || review?.completeEvidence !== true
    || review.model !== portalDiscoveryModelPolicy.offlineReview.model || !portalDiscoveryModelPolicy.offlineReview.allowedReasoning.includes(review.reasoning)) reasons.push("independent-sanitization-and-evidence-review-required");
  const changes = [];
  const inventory = analysis ? await buildSpecRouteInventory() : [];
  for (const entry of manifest.changes ?? []) {
    const blockers = [];
    if (!/^specifications\/nodoc-[\w-]+\/specification\/[\w.-]+\.ya?ml$/u.test(entry.destination)) {
      changes.push({ destination: "invalid", evidenceCount: 0, eligible: false, reasonCodes: ["destination-outside-specification-scope"] }); continue;
    }
    try {
      if (!proposalRoot) throw new Error("Proposal root required.");
      const root = await privateRefreshDirectory(proposalRoot);
      if (path.dirname(path.resolve(entry.proposal)) !== root) throw new Error("Proposal outside root.");
      await assertNoRefreshLinks(entry.proposal);
      await assertNoRefreshLinks(path.join(repoRoot, entry.destination));
    } catch {
      changes.push({ destination: entry.destination, evidenceCount: 0, eligible: false, reasonCodes: ["private-proposal-root-unproved"] }); continue;
    }
    const original = await readFile(path.join(repoRoot, entry.destination), "utf8");
    const proposed = await readFile(entry.proposal, "utf8");
    const currentHash = hash(original);
    if (![entry.beforeSha256, entry.proposalSha256].includes(currentHash) || hash(proposed) !== entry.proposalSha256) blockers.push("source-or-proposal-drift");
    if (currentHash !== entry.proposalSha256 || checks?.appliedChanges?.[entry.destination] !== entry.proposalSha256) blockers.push("checks-have-not-validated-final-applied-proposal");
    // The exact original bytes are needed to classify a diff after application.
    const before = entry.beforeSource ?? original;
    if (hash(before) !== entry.beforeSha256) blockers.push("original-source-unavailable-or-drifted");
    const additions = additionsOnly(YAML.parse(before), YAML.parse(proposed));
    if (!additions.length) blockers.push("no-semantic-change");
    for (const addition of additions) {
      // Only a missing response schema or an explicitly synthetic named example.
      const tail = addition.pointer.slice(-4);
      const syntheticExample = tail.slice(-2).join("/") === "examples/syntheticRefresh" ? addition.value
        : tail.at(-1) === "examples" && Object.keys(addition.value ?? {}).join() === "syntheticRefresh" ? addition.value.syntheticRefresh : null;
      if (addition.kind !== "addition" || !addition.pointer.includes("responses")
        || !(tail.at(-1) === "schema" || syntheticExample)) blockers.push("change-needs-contract-review");
      if (tail.at(-1) === "schema" && !narrowSchema(addition.value)) blockers.push("schema-constraints-or-composition-need-review");
      if (syntheticExample && !syntheticValuesOnly(syntheticExample.value)) blockers.push("example-values-are-not-synthetic");
    }
    const evidence = manifest.evidence?.filter(item => item.destination === entry.destination) ?? [];
    blockers.push(...await bindProposedEdits({ entry, before, proposed, evidence, analysis, inventory }));
    if (!evidence.length || evidence.some(item => !item.evidenceId || !item.captureId || !Number.isInteger(item.actionIndex) || item.actionIndex < 0)) blockers.push("exact-observation-traceability-incomplete");
    if (evidence.some(item => item.method !== "GET")) blockers.push("method-requires-manual-safety-review");
    changes.push({ destination: entry.destination, evidenceCount: evidence.length, eligible: blockers.length === 0 && reasons.length === 0, reasonCodes: [...new Set([...reasons, ...blockers])].sort() });
  }
  const terminalSource = await refreshSourceState();
  if (terminalSource.sourceRevision !== actualSource.sourceRevision || terminalSource.sourceStateDigest !== actualSource.sourceStateDigest) {
    reasons.push("source-changed-during-eligibility");
    for (const change of changes) { change.eligible = false; change.reasonCodes.push("source-changed-during-eligibility"); }
  }
  return { schemaVersion: 1, mode: "dry-run", actualAutomaticMergingEnabled: false, rulesRequireExplicitUserAuthorization: true,
    eligible: changes.length > 0 && changes.every(change => change.eligible), reasonCodes: [...new Set(reasons)].sort(), changes };
}
