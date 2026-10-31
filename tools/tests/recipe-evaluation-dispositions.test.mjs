import assert from "node:assert/strict";
import test from "node:test";
import {validateRecipeEvaluationManifest} from "../recipe-evaluation-dispositions.mjs";

const sha = "a".repeat(64);
const reference = {artifactId: "reviewed-private-evidence", sha256: sha};
const binding = new Map([["tools/capture-recipes/example.json", {specId: "example", sha256: sha, knownOperationRefresh: true}]]);
function entry() {
  return {
    recipePath: "tools/capture-recipes/example.json", specId: "example", recipeSha256: sha,
    disposition: "evaluated-with-gaps", limitations: ["Business health remains unknown."],
    nextRequirement: "Obtain an action-attributed body for the selected route.",
    independentReview: reference, solGate: reference,
    terminals: [{assignmentId: "example-01", captureComplete: false, status: "blocked", artifact: reference}],
  };
}
const validate = (record) => validateRecipeEvaluationManifest({schemaVersion: 1, evaluations: [record]}, binding);

test("reviewed incomplete and error outcomes remain dispositions with gaps", () => {
  const input = entry();
  const result = validate(input);
  assert.equal(result.get(input.recipePath).disposition, "evaluated-with-gaps");
  assert.equal(result.get(input.recipePath).terminals[0].captureComplete, false);
  assert.equal(validateRecipeEvaluationManifest({schemaVersion: 1, evaluations: []}, binding).size, 0);
});

test("missing, stale, wrong-owner and duplicate evidence cannot satisfy a recipe", () => {
  for (const change of [
    {recipeSha256: "b".repeat(64)}, {specId: "other"}, {recipePath: "tools/capture-recipes/other.json"},
    {independentReview: null}, {solGate: {artifactId: "C:/private/path", sha256: sha}},
    {terminals: []}, {limitations: []}, {nextRequirement: ""}, {disposition: "healthy"},
  ]) assert.throws(() => validate({...entry(), ...change}));
  assert.throws(() => validateRecipeEvaluationManifest({schemaVersion: 1, evaluations: [entry(), entry()]}, binding), /duplicate/u);
});

test("an unexecuted recipe needs an explicit evidence-bound blocked prerequisite", () => {
  const input = {...entry(), disposition: "blocked-prerequisite", terminals: []};
  assert.throws(() => validate(input), /prerequisite/u);
  input.capturePrerequisite = {status: "blocked", nextRequirement: input.nextRequirement};
  input.prerequisiteEvidence = reference;
  assert.equal(validate(input).size, 1);
  input.capturePrerequisite.nextRequirement = "different requirement";
  assert.throws(() => validate(input), /prerequisite/u);
});
