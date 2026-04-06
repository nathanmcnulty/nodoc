import { buildSpecQuality } from "./spec-quality-lib.mjs";

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

const qualityByTitle = await buildSpecQuality();
const failures = collectFailures(qualityByTitle);

if (failures.length > 0) {
  console.error("Spec quality regression detected:");
  console.table(failures);
  process.exitCode = 1;
} else {
  console.log(`Validated spec quality for ${Object.keys(qualityByTitle).length} published specs.`);
}
