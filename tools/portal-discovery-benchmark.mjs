import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const benchmarkSchemaVersion = 1;
const stableJson = (value) => `${JSON.stringify(value)}\n`;
export const benchmarkDigest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
const unsafe = /tenant|bearer|cookie|authorization|password|secret|credential|https?:\/\/|[A-Za-z]:\\/iu;
const corpusPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "benchmarks", "portal-discovery-offline-v1.json");

export async function loadBenchmarkCorpus(filePath = corpusPath) {
  const corpus = JSON.parse(await readFile(filePath, "utf8"));
  if (!corpus || corpus.schemaVersion !== benchmarkSchemaVersion || !Array.isArray(corpus.scenarios)) throw new Error("Unsupported or corrupt benchmark corpus.");
  if (unsafe.test(JSON.stringify(corpus))) throw new Error("Benchmark corpus contains prohibited sensitive data.");
  return corpus;
}

export const benchmarkModes = ["fixture", "measured"];
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Fixture mode falls back to each scenario's syntheticResult so the corpus can
// self-test. Measured mode scores only supplied worker outputs; a missing
// scenario fails instead of borrowing the fixture answer.
function checkedInputs(corpus, inputs, mode) {
  if (!benchmarkModes.includes(mode)) throw new Error(`Unsupported benchmark mode ${mode}.`);
  if (!plainObject(inputs)) throw new Error("Benchmark inputs must be an object keyed by scenarioId.");
  const known = new Set(corpus.scenarios.map((scenario) => scenario.scenarioId));
  for (const [scenarioId, value] of Object.entries(inputs)) {
    if (!known.has(scenarioId)) throw new Error(`Benchmark input names unknown scenario ${scenarioId}.`);
    if (!plainObject(value)) throw new Error(`Benchmark input for ${scenarioId} must be an object.`);
  }
  if (unsafe.test(JSON.stringify(inputs))) throw new Error("Benchmark inputs contain prohibited sensitive data.");
  return inputs;
}

export function runOfflineBenchmark(corpus, { inputs = {}, mode = "fixture" } = {}) {
  if (!corpus || corpus.schemaVersion !== benchmarkSchemaVersion) throw new Error("Unsupported benchmark corpus schema.");
  const supplied = checkedInputs(corpus, inputs, mode);
  const measured = mode === "measured";
  const results = corpus.scenarios.map((scenario) => {
    const assertions = scenario.assertions ?? {};
    const base = { scenarioId: scenario.scenarioId, scenarioDigest: benchmarkDigest(scenario), expected: assertions };
    if (!Object.hasOwn(supplied, scenario.scenarioId) && measured) return { ...base, actual: null, evidenceSource: "missing", status: "missing-input", reasonCodes: ["missing-worker-output"] };
    const evidenceSource = Object.hasOwn(supplied, scenario.scenarioId) ? "caller-supplied-result" : "fixture-self-check";
    const actual = evidenceSource === "caller-supplied-result" ? supplied[scenario.scenarioId] : scenario.syntheticResult ?? {};
    const mismatches = Object.entries(assertions).filter(([key, expected]) => JSON.stringify(actual[key]) !== JSON.stringify(expected)).map(([key]) => `assertion:${key}`);
    return { ...base, actual, evidenceSource, status: mismatches.length ? "fail" : "pass", reasonCodes: mismatches };
  }).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  const count = (predicate) => results.filter(predicate).length;
  const core = { schemaVersion: benchmarkSchemaVersion, mode, corpusId: corpus.corpusId, corpusDigest: benchmarkDigest(corpus), results, measurements: {
    scenarioCount: results.length, passCount: count((r) => r.status === "pass"), failCount: count((r) => r.status !== "pass"),
    driftCount: count((r) => r.status === "fail"), missingInputCount: count((r) => r.status === "missing-input"),
    suppliedInputCount: count((r) => r.evidenceSource === "caller-supplied-result"), fixtureFallbackCount: count((r) => r.evidenceSource === "fixture-self-check"),
    inputBytes: Buffer.byteLength(stableJson(corpus), "utf8"), outputBytes: 0, synthetic: !measured,
    caveat: measured
      ? "Supplied worker outputs scored against synthetic assertions; byte values remain proxies, not real token, cost, quality, or portal coverage claims."
      : "Synthetic byte/cardinality/tokenizer-estimate proxies; not real token, cost, quality, or portal coverage claims.",
  } };
  core.measurements.outputBytes = Buffer.byteLength(stableJson(core), "utf8");
  return { ...core, benchmarkId: `benchmark-${benchmarkDigest(core).slice(0, 24)}`, benchmarkDigest: benchmarkDigest(core) };
}

export function validateBenchmarkScorecard(scorecard) {
  if (!scorecard || scorecard.schemaVersion !== benchmarkSchemaVersion || scorecard.benchmarkDigest !== benchmarkDigest(Object.fromEntries(Object.entries(scorecard).filter(([key]) => !["benchmarkId", "benchmarkDigest"].includes(key))))) throw new Error("Benchmark scorecard digest or schema mismatch.");
  return scorecard;
}

// A measured inputs file binds worker outputs to one corpus:
// { "corpusId": "portal-discovery-offline-v1", "inputs": { "<scenarioId>": { ... } } }
export async function loadBenchmarkInputs(filePath, corpus) {
  const file = JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/u, ""));
  if (!plainObject(file) || file.corpusId !== corpus.corpusId || !plainObject(file.inputs)) throw new Error(`Benchmark inputs must declare corpusId ${corpus.corpusId} and an inputs object.`);
  return file.inputs;
}

async function main(argv) {
  let corpusFile = corpusPath, inputsFile = null, mode = "fixture";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--measured") mode = "measured";
    else if (argv[index] === "--inputs") inputsFile = argv[++index];
    else if (argv[index].startsWith("--")) throw new Error(`Unknown option ${argv[index]}.`);
    else corpusFile = argv[index];
  }
  if (mode === "measured" && !inputsFile) throw new Error("--measured requires --inputs <file>.");
  const corpus = await loadBenchmarkCorpus(corpusFile);
  const inputs = inputsFile ? await loadBenchmarkInputs(inputsFile, corpus) : {};
  const scorecard = runOfflineBenchmark(corpus, { inputs, mode });
  console.log(stableJson(scorecard));
  if (scorecard.measurements.failCount > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
