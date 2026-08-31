import assert from "node:assert/strict";
import test from "node:test";

import { buildEvaluationStatus } from "../generate-recipe-audit.mjs";

const status = (overrides = {}) => buildEvaluationStatus({
  blockedPrerequisiteCount: 0,
  derivedResearchSurface: false,
  noveltyTargetCount: 0,
  satisfiedNoveltyCount: 0,
  ...overrides,
});

test("recipe evaluation status fails open frontiers ahead of terminal sibling recipes", () => {
  assert.equal(status({ noveltyTargetCount: 1, satisfiedNoveltyCount: 1 }), "active-frontier");
  assert.equal(status({ blockedPrerequisiteCount: 1, satisfiedNoveltyCount: 1 }), "blocked-prerequisite");
  assert.equal(status({
    blockedPrerequisiteCount: 1,
    noveltyTargetCount: 1,
    satisfiedNoveltyCount: 1,
  }), "active-frontier");
});

test("recipe evaluation status accepts only explicit terminal dispositions", () => {
  assert.equal(status({ satisfiedNoveltyCount: 1 }), "satisfied");
  assert.equal(status({ blockedPrerequisiteCount: 1 }), "blocked-prerequisite");
  assert.equal(status({ derivedResearchSurface: true }), "derived-current");
  assert.equal(status(), "needs-frontier");
});
