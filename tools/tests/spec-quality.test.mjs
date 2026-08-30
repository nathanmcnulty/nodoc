import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSpecQuality,
  getNormalizedOperationContextRecords,
  loadBundledSpecification,
  validateOperationIds,
} from "../spec-quality-lib.mjs";

test("operation context accepts agent-oriented permissions, pagination, and troubleshooting guidance", () => {
  const records = getNormalizedOperationContextRecords({
    paths: {
      "/items": {
        get: {
          operationId: "Items.List",
          "x-nodoc-operation-context": {
            permissions: ["Items.Read delegated scope"],
            pagination: {
              style: "cursor",
              requestParameters: ["cursor"],
              responseFields: ["nextCursor"],
              notes: ["Omit cursor on the first request."],
            },
            troubleshooting: ["A 403 indicates the selected principal lacks Items.Read."],
          },
          responses: { 200: { description: "ok" } },
        },
      },
    },
  }, "fixture");
  assert.deepEqual(records.operations[0].operationContext, {
    permissions: ["Items.Read delegated scope"],
    troubleshooting: ["A 403 indicates the selected principal lacks Items.Read."],
    pagination: {
      style: "cursor",
      requestParameters: ["cursor"],
      responseFields: ["nextCursor"],
      notes: ["Omit cursor on the first request."],
    },
  });
  assert.throws(() => getNormalizedOperationContextRecords({
    paths: { "/items": { get: { "x-nodoc-operation-context": { pagination: { style: "guess" } } } } },
  }, "fixture"), /invalid style/);
});

test("Entra IAM has a stable unique operation ID for every operation", async () => {
  const specification = await loadBundledSpecification(
    fileURLToPath(new URL(
      "../../specifications/nodoc-ibiza-iam/specification/openapi.yml",
      import.meta.url,
    )),
  );

  assert.deepEqual(validateOperationIds(specification, "Entra IAM"), {
    operationCount: 286,
    operationIds: 286,
  });
});

test("M365 Apps Services has agent-ready context and stable operation IDs", async () => {
  const specification = await loadBundledSpecification(
    fileURLToPath(new URL(
      "../../specifications/nodoc-m365-apps-services/specification/openapi.yml",
      import.meta.url,
    )),
  );

  assert.deepEqual(validateOperationIds(specification, "M365 Apps Services"), {
    operationCount: 9,
    operationIds: 9,
  });
  assert.equal(
    getNormalizedOperationContextRecords(specification, "M365 Apps Services").operations.length,
    9,
  );
});

test("Entra IDGov has agent-ready context and stable operation IDs", async () => {
  const specification = await loadBundledSpecification(
    fileURLToPath(new URL(
      "../../specifications/nodoc-entra-idgov/specification/openapi.yml",
      import.meta.url,
    )),
  );

  assert.deepEqual(validateOperationIds(specification, "Entra IDGov"), {
    operationCount: 17,
    operationIds: 17,
  });
  assert.equal(
    getNormalizedOperationContextRecords(specification, "Entra IDGov").operations.length,
    17,
  );
});

test("M365 Admin keeps SetTheme on its canonical company theme path", async () => {
  const specification = await loadBundledSpecification(
    fileURLToPath(new URL(
      "../../specifications/nodoc-m365-admin/specification/openapi.yml",
      import.meta.url,
    )),
  );

  assert.equal(
    specification.paths["/admin/api/Settings/company/theme/v2"].put.operationId,
    "CompanySettings.SetTheme",
  );
  assert.equal(
    specification.paths["/_api/SPOInternalUseOnly.TenantAdminSettings/AutoQuotaEnabled"].put,
    undefined,
  );
});

test("Teams catalog and quality count operations rather than path keys", async () => {
  const specification = await loadBundledSpecification(
    fileURLToPath(new URL(
      "../../specifications/nodoc-teams/specification/openapi.yml",
      import.meta.url,
    )),
  );
  const qualityByTitle = await buildSpecQuality();
  const siteDataSource = await readFile(
    fileURLToPath(new URL("../../src/data/siteData.ts", import.meta.url)),
    "utf8",
  );
  const teamsCatalogSeed = siteDataSource.match(
    /title: "Teams",[\s\S]*?collectionPath: "postman\/collections\/teams\.collection\.json"/u,
  )?.[0];

  assert.equal(Object.keys(specification.paths).length, 99);
  assert.equal(qualityByTitle.Teams.operationCount, 100);
  assert.match(teamsCatalogSeed ?? "", /operations: 100/u);
});

test("operation ID validation rejects missing and duplicate IDs", () => {
  assert.throws(
    () => validateOperationIds({ paths: {
      "/items": {
        get: { operationId: "Items.Get" },
        post: { operationId: "Items.Get" },
        delete: {},
      },
    } }, "fixture"),
    /fixture has invalid operation IDs .*missing: DELETE \/items.*duplicates: Items\.Get/,
  );
});
