// Reviewed publication summaries are separate from live evidence verification.
// Matching this manifest means a disposition was reviewed for these recipe
// bytes; it never proves freshness, business health, schema coverage or access.
const hashPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/u;
const fail = (message) => { throw new Error(`Recipe evaluation: ${message}`); };
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

function artifact(reference, label) {
  if (!reference || !idPattern.test(reference.artifactId ?? "")
      || !hashPattern.test(reference.sha256 ?? "")) fail(`invalid ${label} reference`);
}

export function validateRecipeEvaluationManifest(manifest, currentBindings) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.evaluations)) fail("invalid manifest schema");
  const result = new Map();
  for (const entry of manifest.evaluations) {
    const binding = currentBindings.get(entry.recipePath);
    if (!binding?.knownOperationRefresh || binding.specId !== entry.specId) fail("recipe owner or refresh binding mismatch");
    if (result.has(entry.recipePath)) fail("duplicate recipe disposition");
    if (!hashPattern.test(entry.recipeSha256 ?? "") || entry.recipeSha256 !== binding.sha256) fail(`stale recipe: ${entry.recipePath}`);
    if (!["evaluated-with-gaps", "blocked-prerequisite"].includes(entry.disposition)) fail("unsupported disposition");
    if (!Array.isArray(entry.limitations) || !entry.limitations.length || !entry.limitations.every(nonempty)) fail("missing limitations");
    artifact(entry.independentReview, "independent review");
    artifact(entry.solGate, "Sol gate");
    if (!nonempty(entry.nextRequirement)) fail("missing reopen requirement");
    if (entry.disposition === "blocked-prerequisite") {
      if (entry.capturePrerequisite?.status !== "blocked" || !nonempty(entry.capturePrerequisite.nextRequirement)
          || entry.capturePrerequisite.nextRequirement !== entry.nextRequirement) fail("blocked disposition lacks its explicit prerequisite");
      artifact(entry.prerequisiteEvidence, "prerequisite evidence");
    } else {
      if (!Array.isArray(entry.terminals) || !entry.terminals.length) fail("reviewed disposition lacks terminal evidence");
      for (const terminal of entry.terminals) {
        // Public summaries can omit private runtime identifiers; the immutable
        // artifact reference remains mandatory. Runtime handoffs require IDs.
        if ((Object.hasOwn(terminal, "assignmentId") && !idPattern.test(terminal.assignmentId ?? "")) || typeof terminal.captureComplete !== "boolean"
            || !["completed", "blocked", "failed"].includes(terminal.status)) fail("invalid terminal outcome");
        artifact(terminal.artifact, "terminal");
      }
    }
    result.set(entry.recipePath, entry);
  }
  return result;
}
