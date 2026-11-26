import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./spec-quality-lib.mjs";
import {
  assertOperationIndexShape,
  buildOperationIndex,
  loadSiteSpecifications,
  operationIndexPath,
  serializeOperationIndex,
} from "./site-artifacts.mjs";

const index = await buildOperationIndex(await loadSiteSpecifications());
assertOperationIndexShape(index);
await mkdir(path.dirname(operationIndexPath), { recursive: true });
await writeFile(operationIndexPath, serializeOperationIndex(index), "utf8");
const unanchored = index.operations.filter(operation => !operation.anchor).length;
console.log(`Generated ${path.relative(repoRoot, operationIndexPath).replaceAll("\\", "/")} (${index.specs.length} specs, ${index.operations.length} operations, ${unanchored} without a reference anchor)`);
