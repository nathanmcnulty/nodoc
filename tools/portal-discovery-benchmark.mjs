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

export function runOfflineBenchmark(corpus, { inputs = {} } = {}) {
  if (!corpus || corpus.schemaVersion !== benchmarkSchemaVersion) throw new Error("Unsupported benchmark corpus schema.");
  const results = corpus.scenarios.map((scenario) => {
    const actual = inputs[scenario.scenarioId] ?? scenario.syntheticResult ?? {};
    const assertions = scenario.assertions ?? {};
    const mismatches = Object.entries(assertions).filter(([key, expected]) => JSON.stringify(actual[key]) !== JSON.stringify(expected)).map(([key]) => `assertion:${key}`);
    return { scenarioId: scenario.scenarioId, scenarioDigest: benchmarkDigest(scenario), expected: assertions, actual, status: mismatches.length ? "fail" : "pass", reasonCodes: mismatches };
  }).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  const core = { schemaVersion: benchmarkSchemaVersion, corpusId: corpus.corpusId, corpusDigest: benchmarkDigest(corpus), results, measurements: { scenarioCount: results.length, passCount: results.filter((r) => r.status === "pass").length, failCount: results.filter((r) => r.status === "fail").length, driftCount: results.filter((r) => r.reasonCodes.length).length, inputBytes: Buffer.byteLength(stableJson(corpus), "utf8"), outputBytes: 0, synthetic: true, caveat: "Synthetic byte/cardinality/tokenizer-estimate proxies; not real token, cost, quality, or portal coverage claims." } };
  core.measurements.outputBytes = Buffer.byteLength(stableJson(core), "utf8");
  return { ...core, benchmarkId: `benchmark-${benchmarkDigest(core).slice(0, 24)}`, benchmarkDigest: benchmarkDigest(core) };
}

export function validateBenchmarkScorecard(scorecard) {
  if (!scorecard || scorecard.schemaVersion !== benchmarkSchemaVersion || scorecard.benchmarkDigest !== benchmarkDigest(Object.fromEntries(Object.entries(scorecard).filter(([key]) => !["benchmarkId", "benchmarkDigest"].includes(key))))) throw new Error("Benchmark scorecard digest or schema mismatch.");
  return scorecard;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) loadBenchmarkCorpus(process.argv[2] ?? corpusPath).then((corpus) => console.log(stableJson(runOfflineBenchmark(corpus)))).catch((error) => { console.error(error.message); process.exitCode = 1; });
