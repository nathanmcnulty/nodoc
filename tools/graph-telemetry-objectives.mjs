export function evaluateGraphTelemetryObjectives({ objectives = null, telemetry = null } = {}) {
  if (!objectives) return null;
  const operations = telemetry?.operations ?? [];
  const operationKeys = operations.map((entry) => `${entry.version} ${entry.method} ${entry.path}`);
  const baseline = new Set(objectives.baselineOperationKeys ?? []);
  const newOperationKeys = operationKeys.filter((key) => !baseline.has(key));
  const productExclusions = new Set(objectives.productExcludeOperationKeys ?? []);
  const newEnrichedProductOperationKeys = operations.filter((entry) => {
    const key = `${entry.version} ${entry.method} ${entry.path}`;
    if (baseline.has(key) || productExclusions.has(key)) return false;
    if (objectives.productProxyOnly === true && !(entry.transportKinds ?? []).some((kind) => kind !== "direct-graph")) return false;
    return (entry.statuses ?? []).some((status) => status >= 200 && status < 300)
      && (entry.responseShapeDigests ?? []).length > 0;
  }).map((entry) => `${entry.version} ${entry.method} ${entry.path}`);
  const enrichedOperationCount = operations.filter((entry) => (
    entry.statuses?.length > 0
    && (entry.requestShapeDigests?.length > 0 || entry.responseShapeDigests?.length > 0)
  )).length;
  const observedPages = operations.flatMap((entry) => entry.seenOnPages ?? []).filter((entry) => !String(entry).startsWith("seed-"));
  const checkpointCount = new Set(observedPages.length > 0 ? observedPages : operations.flatMap((entry) => entry.checkpoints ?? [])).size;
  const measurements = {
    batchMemberCount: telemetry?.measurements?.batchMemberCount ?? 0,
    checkpointCount,
    enrichedOperationCount,
    newOperationCount: newOperationKeys.length,
    newEnrichedProductOperationCount: newEnrichedProductOperationKeys.length,
    operationCount: operations.length,
    proxyOperationCount: telemetry?.measurements?.proxyTransportOperationCount ?? 0,
    undocumentedCandidateCount: telemetry?.measurements?.undocumentedCandidateCount ?? 0,
  };
  const contractAvailable = ["beta", "v1.0"].every((version) => telemetry?.contractVersions?.includes(version))
    && Boolean(telemetry?.contractSnapshot?.commitSha);
  const checks = [
    { name: "contract", required: objectives.contractRequired === true, satisfied: contractAvailable },
    { name: "operations", required: Number(objectives.minimumOperationCount ?? 0) > 0, satisfied: measurements.operationCount >= Number(objectives.minimumOperationCount ?? 0) },
    { name: "proxy-operations", required: Number(objectives.minimumProxyOperationCount ?? 0) > 0, satisfied: measurements.proxyOperationCount >= Number(objectives.minimumProxyOperationCount ?? 0) },
    { name: "new-operations", required: Number(objectives.minimumNewOperationCount ?? 0) > 0, satisfied: measurements.newOperationCount >= Number(objectives.minimumNewOperationCount ?? 0) },
    { name: "new-enriched-product-operations", required: Number(objectives.minimumNewEnrichedProductOperationCount ?? 0) > 0, satisfied: measurements.newEnrichedProductOperationCount >= Number(objectives.minimumNewEnrichedProductOperationCount ?? 0) },
    { name: "batch-members", required: Number(objectives.minimumBatchMemberCount ?? 0) > 0, satisfied: measurements.batchMemberCount >= Number(objectives.minimumBatchMemberCount ?? 0) },
    { name: "enriched-operations", required: Number(objectives.minimumEnrichedOperationCount ?? 0) > 0, satisfied: measurements.enrichedOperationCount >= Number(objectives.minimumEnrichedOperationCount ?? 0) },
    { name: "checkpoints", required: Number(objectives.minimumCheckpointCount ?? 0) > 0, satisfied: measurements.checkpointCount >= Number(objectives.minimumCheckpointCount ?? 0) },
  ];
  const failedChecks = checks.filter((entry) => entry.required && !entry.satisfied).map((entry) => entry.name);
  const status = failedChecks.length === 0
    ? "productive"
    : objectives.contractRequired && !contractAvailable
      ? "contract-unavailable"
      : measurements.operationCount === 0
        ? "no-graph-signal"
        : "objective-incomplete";
  return {
    schemaVersion: 1,
    status,
    contractAvailable,
    failedChecks,
    measurements,
    newOperationKeys,
    newEnrichedProductOperationKeys,
  };
}
