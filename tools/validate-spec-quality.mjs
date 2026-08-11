import { fileURLToPath } from "node:url";

import {
  buildOperationContextLedger,
  buildSpecQuality,
  loadBundledSpecification,
  validateOperationIds,
} from "./spec-quality-lib.mjs";

function collectFailures(qualityByTitle) {
  const failures = [];

  for (const quality of Object.values(qualityByTitle)) {
    if (!quality.navigationStandardized) {
      failures.push({
        title: quality.title,
        issue: "navigation",
        detail: `${quality.ungroupedTagCount} ungrouped, ${quality.duplicateGroupedTagCount} duplicate-grouped, ${quality.hostLikeTagGroupCount} host-like groups`,
      });
    }

    if (!quality.metadataComplete) {
      const missing = [
        !quality.contactDefined && "contact",
        !quality.licenseDefined && "license",
        !quality.externalDocsDefined && "externalDocs",
        !quality.allServersDescribed && "server descriptions",
      ].filter(Boolean).join(", ");

      failures.push({
        title: quality.title,
        issue: "metadata",
        detail: missing,
      });
    }

    if (quality.publicLiveCaptureDescriptionCount > 0) {
      failures.push({
        title: quality.title,
        issue: "public-live-capture",
        detail: `${quality.publicLiveCaptureDescriptionCount} live-capture descriptions still render publicly`,
      });
    }
  }

  return failures;
}

async function collectOperationContextFailures() {
  try {
    await buildOperationContextLedger();
    return [];
  } catch (error) {
    return [
      {
        title: "Operation context ledger",
        issue: "auth-redaction",
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function collectIbizaIamOperationIdFailures() {
  try {
    const specification = await loadBundledSpecification(
      fileURLToPath(new URL(
        "../specifications/nodoc-ibiza-iam/specification/openapi.yml",
        import.meta.url,
      )),
    );
    validateOperationIds(specification, "Entra IAM");
    return [];
  } catch (error) {
    return [{
      title: "Entra IAM",
      issue: "operation-ids",
      detail: error instanceof Error ? error.message : String(error),
    }];
  }
}

const qualityByTitle = await buildSpecQuality();
const failures = [
  ...collectFailures(qualityByTitle),
  ...(await collectOperationContextFailures()),
  ...(await collectIbizaIamOperationIdFailures()),
];

if (failures.length > 0) {
  console.error("Spec quality regression detected:");
  console.table(failures);
  process.exitCode = 1;
} else {
  console.log(`Validated spec quality for ${Object.keys(qualityByTitle).length} published specs.`);
}
