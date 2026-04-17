import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "@scalar/openapi-parser";
import { readFiles } from "@scalar/openapi-parser/plugins/read-files";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..");
const specificationsDir = path.join(repoRoot, "specifications");
const gitHubRepositoryUrl = "https://github.com/nathanmcnulty/nodoc";
const rawGitHubRepositoryUrl =
  "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main";
const httpMethods = new Set([
  "get",
  "put",
  "post",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

function uniqueOrdered(values) {
  if (!Array.isArray(values)) {
    throw new Error("Expected an array of strings.");
  }

  const seen = new Set();
  const ordered = [];

  for (const value of values) {
    if (typeof value !== "string") {
      throw new Error("Expected an array of strings.");
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function cloneObject(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function decodePointerToken(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function getByPointer(root, pointer) {
  if (!pointer || pointer === "#") {
    return root;
  }

  const normalized = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (!normalized) {
    return root;
  }

  return normalized.split("/").slice(1).reduce((current, part) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    return current[decodePointerToken(part)];
  }, root);
}

function splitReference(value) {
  const [filePart, fragmentPart] = value.split("#");
  return {
    filePart: filePart || "",
    fragment: fragmentPart ? `#${fragmentPart}` : "#",
  };
}

function isHttpUrl(value) {
  return /^https?:\/\//iu.test(value || "");
}

function resolveReferenceFile(currentFile, refFile) {
  if (!refFile) {
    return currentFile;
  }

  if (isHttpUrl(refFile)) {
    return refFile;
  }

  if (isHttpUrl(currentFile)) {
    return new URL(refFile, currentFile).toString();
  }

  const currentDir =
    currentFile && currentFile.includes("/")
      ? currentFile.slice(0, currentFile.lastIndexOf("/"))
      : ".";

  return path.posix.normalize(path.posix.join(currentDir, refFile));
}

function createSpecificationMap(fileSystem) {
  return new Map(
    fileSystem.filesystem
      .filter((entry) => entry.isEntrypoint || entry.filename)
      .map((entry) => [entry.filename || ".", entry.specification]),
  );
}

function bundleSpecification(fileSystem) {
  const entry =
    fileSystem.filesystem.find((item) => item.isEntrypoint) || fileSystem;
  const specificationMap = createSpecificationMap(fileSystem);
  const cache = new Map();

  function expandNode(node, currentFile, stack = []) {
    if (Array.isArray(node)) {
      return node.map((item) => expandNode(item, currentFile, stack));
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    if (typeof node.$ref === "string") {
      const { filePart, fragment } = splitReference(node.$ref);
      const targetFile = resolveReferenceFile(currentFile, filePart);
      const cacheKey = `${targetFile}|${fragment}`;

      if (stack.includes(cacheKey)) {
        return cloneObject(node);
      }

      if (cache.has(cacheKey)) {
        const siblings = Object.fromEntries(
          Object.entries(node).filter(([key]) => key !== "$ref"),
        );
        return Object.keys(siblings).length > 0
          ? {
              ...cloneObject(cache.get(cacheKey)),
              ...expandNode(siblings, currentFile, stack),
            }
          : cloneObject(cache.get(cacheKey));
      }

      const root = specificationMap.get(targetFile);
      if (!root) {
        throw new Error(
          `Unable to resolve external reference "${node.$ref}" from "${currentFile}"`,
        );
      }

      const target = getByPointer(root, fragment);
      if (typeof target === "undefined") {
        throw new Error(
          `Unable to resolve pointer "${fragment}" in "${targetFile}"`,
        );
      }

      const expanded = expandNode(target, targetFile, [...stack, cacheKey]);
      cache.set(cacheKey, cloneObject(expanded));

      const siblings = Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== "$ref"),
      );
      return Object.keys(siblings).length > 0
        ? { ...cloneObject(expanded), ...expandNode(siblings, currentFile, stack) }
        : cloneObject(expanded);
    }

    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        expandNode(value, currentFile, stack),
      ]),
    );
  }

  return expandNode(entry.specification, ".");
}

async function loadBundledSpecification(specPath) {
  const fileSystem = await load(specPath, {
    plugins: [readFiles()],
  });

  return bundleSpecification(fileSystem);
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

function hasExamples(content) {
  return Object.values(content ?? {}).some((mediaType) => {
    if (!mediaType || typeof mediaType !== "object") {
      return false;
    }

    const schema = mediaType.schema && typeof mediaType.schema === "object"
      ? mediaType.schema
      : {};
    return (
      Object.hasOwn(mediaType, "example")
      || Object.hasOwn(mediaType, "examples")
      || Object.hasOwn(schema, "example")
      || Object.hasOwn(schema, "examples")
    );
  });
}

function getOperationEntries(specification) {
  return Object.entries(specification.paths ?? {}).flatMap(([pathname, pathItem]) => (
    Object.entries(pathItem ?? {})
      .filter(([method, operation]) => httpMethods.has(method) && operation && typeof operation === "object")
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        operation,
        path: pathname,
      }))
  ));
}

function getOperations(specification) {
  return getOperationEntries(specification).map(({ operation }) => operation);
}

function normalizeLiveCaptureMetadata(value, context) {
  if (value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} has an invalid x-nodoc-live-capture payload.`);
  }

  if (typeof value.source !== "string") {
    throw new Error(`${context} has an invalid x-nodoc-live-capture.source value.`);
  }

  const source = value.source.trim();
  if (!source) {
    throw new Error(`${context} is missing x-nodoc-live-capture.source.`);
  }

  if (!Array.isArray(value.browsedPages)) {
    throw new Error(`${context} has an invalid x-nodoc-live-capture.browsedPages value.`);
  }

  let browsedPages;
  try {
    browsedPages = uniqueOrdered(value.browsedPages);
  } catch {
    throw new Error(`${context} has an invalid x-nodoc-live-capture.browsedPages value.`);
  }

  if (browsedPages.length === 0) {
    throw new Error(`${context} must include at least one x-nodoc-live-capture.browsedPages entry.`);
  }

  let additionalPageCount = 0;
  if (value.additionalPageCount !== undefined) {
    if (!Number.isInteger(value.additionalPageCount) || value.additionalPageCount < 0) {
      throw new Error(`${context} has an invalid x-nodoc-live-capture.additionalPageCount value.`);
    }

    additionalPageCount = value.additionalPageCount;
  }

  return {
    source,
    browsedPages,
    additionalPageCount,
  };
}

function normalizeOperationContextString(value, context, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${context} has an invalid ${fieldName} value.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${context} is missing ${fieldName}.`);
  }

  return normalized;
}

function normalizeOperationContextPath(value, context, fieldName) {
  const normalized = normalizeOperationContextString(value, context, fieldName);
  if (normalized === undefined) {
    return undefined;
  }

  if (!normalized.startsWith("/")) {
    throw new Error(`${context} has an invalid ${fieldName} value.`);
  }

  return normalized;
}

function normalizeOperationContextStringArray(value, context, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${context} has an invalid ${fieldName} value.`);
  }

  let normalized;
  try {
    normalized = uniqueOrdered(value);
  } catch {
    throw new Error(`${context} has an invalid ${fieldName} value.`);
  }

  if (normalized.length === 0) {
    throw new Error(`${context} must include at least one ${fieldName} entry.`);
  }

  return normalized;
}

function normalizeHeaderProfileEntries(value, context, fieldName) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${context} has an invalid ${fieldName} value.`);
  }

  const seenNames = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${context} has an invalid ${fieldName}[${index}] value.`);
    }

    const name = normalizeOperationContextString(
      entry.name,
      `${context} ${fieldName}[${index}]`,
      "name",
    );

    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new Error(`${context} includes duplicate ${fieldName} entries for ${name}.`);
    }

    seenNames.add(normalizedName);

    const description = normalizeOperationContextString(
      entry.description,
      `${context} ${fieldName}[${index}]`,
      "description",
    );

    const header = { name };
    if (description !== undefined) {
      header.description = description;
    }

    const headerValue = normalizeOperationContextString(
      entry.value,
      `${context} ${fieldName}[${index}]`,
      "value",
    );
    if (headerValue !== undefined) {
      header.value = headerValue;
    }

    return header;
  });
}

function normalizeHeaderProfiles(value, context) {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} has an invalid x-nodoc-headerProfiles payload.`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([profileName, profileValue]) => {
      const profileContext = `${context} header profile ${profileName}`;
      if (!profileValue || typeof profileValue !== "object" || Array.isArray(profileValue)) {
        throw new Error(`${profileContext} has an invalid value.`);
      }

      const description = normalizeOperationContextString(
        profileValue.description,
        profileContext,
        "description",
      );
      const notes = normalizeOperationContextStringArray(
        profileValue.notes,
        profileContext,
        "notes",
      );
      const requiredHeaders = normalizeHeaderProfileEntries(
        profileValue.requiredHeaders,
        profileContext,
        "requiredHeaders",
      );
      const observedHeaders = normalizeHeaderProfileEntries(
        profileValue.observedHeaders,
        profileContext,
        "observedHeaders",
      );

      if (requiredHeaders.length === 0 && observedHeaders.length === 0) {
        throw new Error(`${profileContext} must include at least one header entry.`);
      }

      return [
        profileName,
        {
          description,
          ...(notes ? { notes } : {}),
          ...(requiredHeaders.length > 0 ? { requiredHeaders } : {}),
          ...(observedHeaders.length > 0 ? { observedHeaders } : {}),
        },
      ];
    }),
  );
}

function normalizeOperationContext(value, context, headerProfileNames = new Set()) {
  if (value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} has an invalid x-nodoc-operation-context payload.`);
  }

  const normalized = {};
  const surface = normalizeOperationContextString(value.surface, context, "surface");
  if (surface !== undefined) {
    normalized.surface = surface;
  }

  const workflows = normalizeOperationContextStringArray(value.workflows, context, "workflows");
  if (workflows !== undefined) {
    normalized.workflows = workflows;
  }

  const headerProfile = normalizeOperationContextString(
    value.headerProfile,
    context,
    "headerProfile",
  );
  if (headerProfile !== undefined) {
    if (headerProfileNames.size > 0 && !headerProfileNames.has(headerProfile)) {
      throw new Error(`${context} references unknown header profile ${headerProfile}.`);
    }

    normalized.headerProfile = headerProfile;
  }

  const canonicalPath = normalizeOperationContextPath(
    value.canonicalPath,
    context,
    "canonicalPath",
  );
  if (canonicalPath !== undefined) {
    normalized.canonicalPath = canonicalPath;
  }

  const pathAliases = normalizeOperationContextStringArray(value.pathAliases, context, "pathAliases");
  if (pathAliases !== undefined) {
    for (const alias of pathAliases) {
      if (!alias.startsWith("/")) {
        throw new Error(`${context} has an invalid pathAliases value.`);
      }
    }

    normalized.pathAliases = pathAliases;
  }

  if (value.requestShapes !== undefined) {
    if (!Array.isArray(value.requestShapes)) {
      throw new Error(`${context} has an invalid requestShapes value.`);
    }

    normalized.requestShapes = value.requestShapes.map((shape, index) => {
      if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
        throw new Error(`${context} has an invalid requestShapes[${index}] value.`);
      }

      const shapeContext = `${context} requestShapes[${index}]`;
      const name = normalizeOperationContextString(shape.name, shapeContext, "name");
      const notes = normalizeOperationContextString(shape.notes, shapeContext, "notes");
      const contentType = normalizeOperationContextString(
        shape.contentType,
        shapeContext,
        "contentType",
      );
      const bodyKind = normalizeOperationContextString(shape.bodyKind, shapeContext, "bodyKind");
      const requiredParameters = normalizeOperationContextStringArray(
        shape.requiredParameters,
        shapeContext,
        "requiredParameters",
      );

      return {
        name,
        ...(contentType !== undefined ? { contentType } : {}),
        ...(bodyKind !== undefined ? { bodyKind } : {}),
        ...(requiredParameters !== undefined ? { requiredParameters } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
    });
  }

  if (value.variants !== undefined) {
    if (!Array.isArray(value.variants)) {
      throw new Error(`${context} has an invalid variants value.`);
    }

    const validVariantLocations = new Set(["query", "body", "header", "path"]);
    normalized.variants = value.variants.map((variant, index) => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        throw new Error(`${context} has an invalid variants[${index}] value.`);
      }

      const variantContext = `${context} variants[${index}]`;
      const selector = normalizeOperationContextString(variant.selector, variantContext, "selector");
      const notes = normalizeOperationContextString(variant.notes, variantContext, "notes");
      const knownValues = normalizeOperationContextStringArray(
        variant.knownValues,
        variantContext,
        "knownValues",
      );
      const location = normalizeOperationContextString(
        variant.location,
        variantContext,
        "location",
      );

      if (location !== undefined && !validVariantLocations.has(location)) {
        throw new Error(`${variantContext} has an invalid location value.`);
      }

      return {
        selector,
        ...(location !== undefined ? { location } : {}),
        ...(knownValues !== undefined ? { knownValues } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
    });
  }

  if (value.availability !== undefined) {
    if (!value.availability || typeof value.availability !== "object" || Array.isArray(value.availability)) {
      throw new Error(`${context} has an invalid availability value.`);
    }

    const availabilityContext = `${context} availability`;
    const level = normalizeOperationContextString(
      value.availability.level,
      availabilityContext,
      "level",
    );
    const validAvailabilityLevels = new Set([
      "global",
      "user-context",
      "tenant-conditional",
      "permission-conditional",
      "feature-gated",
      "preview",
      "request-dependent",
    ]);

    if (!validAvailabilityLevels.has(level)) {
      throw new Error(`${availabilityContext} has an invalid level value.`);
    }

    const notes = normalizeOperationContextStringArray(
      value.availability.notes,
      availabilityContext,
      "notes",
    );

    normalized.availability = {
      level,
      ...(notes !== undefined ? { notes } : {}),
    };
  }

  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) {
      throw new Error(`${context} has an invalid provenance value.`);
    }

    const validConfidenceLevels = new Set(["high", "medium", "low"]);
    normalized.provenance = value.provenance.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${context} has an invalid provenance[${index}] value.`);
      }

      const provenanceContext = `${context} provenance[${index}]`;
      const source = normalizeOperationContextString(entry.source, provenanceContext, "source");
      const confidence = normalizeOperationContextString(
        entry.confidence,
        provenanceContext,
        "confidence",
      );

      if (!validConfidenceLevels.has(confidence)) {
        throw new Error(`${provenanceContext} has an invalid confidence value.`);
      }

      const notes = normalizeOperationContextStringArray(entry.notes, provenanceContext, "notes");
      return {
        source,
        confidence,
        ...(notes !== undefined ? { notes } : {}),
      };
    });
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`${context} must include at least one x-nodoc-operation-context field.`);
  }

  return normalized;
}

function getNormalizedHeaderProfiles(specification, title) {
  return normalizeHeaderProfiles(
    specification["x-nodoc-headerProfiles"],
    `${title} specification`,
  );
}

function getNormalizedOperationContextRecords(specification, title) {
  const headerProfiles = getNormalizedHeaderProfiles(specification, title);
  const headerProfileNames = new Set(Object.keys(headerProfiles));

  return {
    headerProfiles,
    operations: getOperationEntries(specification)
      .map(({ method, operation, path: operationPath }) => {
        const operationContext = normalizeOperationContext(
          operation["x-nodoc-operation-context"],
          `${title} ${method} ${operationPath}`,
          headerProfileNames,
        );

        if (!operationContext) {
          return null;
        }

        return {
          method,
          path: operationPath,
          operation,
          operationContext,
        };
      })
      .filter(Boolean),
  };
}

function getPathPrefixes(specification) {
  return Array.from(new Set(
    Object.keys(specification.paths ?? {})
      .filter((pathKey) => typeof pathKey === "string" && pathKey.startsWith("/"))
      .map((pathKey) => {
        const [firstSegment] = pathKey.slice(1).split("/");
        return firstSegment ? `/${firstSegment}/` : "/";
      }),
  )).sort((left, right) => left.localeCompare(right));
}

export function getDocumentationMaturity(quality) {
  if (
    quality.navigationStandardized
    && quality.metadataComplete
    && quality.placeholderCount <= 5
    && quality.successResponseExampleCount >= 3
  ) {
    return {
      label: "Advanced",
      tone: "success",
      description: "Low placeholder debt with multiple response examples.",
    };
  }

  if (
    quality.navigationStandardized
    && quality.metadataComplete
    && quality.placeholderCount <= 50
    && quality.successResponseExampleCount >= 1
  ) {
    return {
      label: "Growing",
      tone: "warning",
      description: "Solid structure with examples, but still meaningful debt to reduce.",
    };
  }

  return {
    label: "Foundational",
    tone: "neutral",
    description: "Usable structure is in place, but examples or placeholder cleanup still lag.",
  };
}

function buildQualityRecord(specRelativePath, bundledSpecification, rawText) {
  const operations = getOperations(bundledSpecification);
  const {
    headerProfiles,
    operations: operationContextRecords,
  } = getNormalizedOperationContextRecords(
    bundledSpecification,
    bundledSpecification.info?.title ?? specRelativePath,
  );
  const tags = bundledSpecification.tags ?? [];
  const tagGroups = bundledSpecification["x-tagGroups"] ?? [];
  const groupedTags = tagGroups.flatMap((group) => group.tags ?? []);
  const ungroupedTagCount = tags.filter((tag) => !groupedTags.includes(tag.name)).length;
  const duplicateGroupedTagCount = Array.from(new Set(
    groupedTags.filter((tag, index) => groupedTags.indexOf(tag) !== index),
  )).length;
  const singleTagGroupCount = tagGroups.filter((group) => (group.tags ?? []).length === 1).length;
  const mirroredTagGroups =
    tags.length > 1
    && tagGroups.length === tags.length
    && singleTagGroupCount === tagGroups.length;
  const hostLikeTagGroupCount = tagGroups.filter((group) => (
    typeof group.name === "string" && (group.name.includes(".") || group.name.includes("/"))
  )).length;
  const requestExampleCount = operations.filter((operation) => (
    hasExamples(operation.requestBody?.content)
  )).length;
  const successResponseExampleCount = operations.filter((operation) => (
    Object.entries(operation.responses ?? {}).some(([status, response]) => {
      if (!String(status).startsWith("2") && status !== "default") {
        return false;
      }

      return response && typeof response === "object" && hasExamples(response.content);
    })
  )).length;
  const placeholderCount =
    countMatches(rawText, /pending/giu)
    + countMatches(rawText, /Unknown body/gu)
    + countMatches(rawText, /Unknown API response/gu)
    + countMatches(rawText, /Unknown API request/gu);
  const evidenceMentionCount =
    countMatches(rawText, /discovered/giu)
    + countMatches(rawText, /capture/giu)
    + countMatches(rawText, /traffic/giu)
    + countMatches(rawText, /bundle/giu)
    + countMatches(rawText, /probe/giu);

  const quality = {
    title: bundledSpecification.info?.title ?? specRelativePath,
    specPath: specRelativePath.replaceAll("\\", "/"),
    specSourceUrl: `${gitHubRepositoryUrl}/tree/main/${specRelativePath.replaceAll("\\", "/").replace(/\/openapi\.yml$/u, "")}`,
    specDownloadUrl: `${rawGitHubRepositoryUrl}/${specRelativePath.replaceAll("\\", "/")}`,
    operationCount: operations.length,
    tagCount: tags.length,
    tagGroupCount: tagGroups.length,
    ungroupedTagCount,
    duplicateGroupedTagCount,
    singleTagGroupCount,
    hostLikeTagGroupCount,
    navigationStandardized:
      tagGroups.length > 0
      && ungroupedTagCount === 0
      && duplicateGroupedTagCount === 0
      && hostLikeTagGroupCount === 0
      && !mirroredTagGroups,
    displayNameTagCount: tags.filter((tag) => Boolean(tag["x-displayName"])).length,
    metadataComplete: Boolean(
      bundledSpecification.info?.contact
      && bundledSpecification.info?.license
      && bundledSpecification.externalDocs
      && (bundledSpecification.servers ?? []).every(
        (server) => !server || typeof server !== "object" || Boolean(server.description),
      ),
    ),
    contactDefined: Boolean(bundledSpecification.info?.contact),
    licenseDefined: Boolean(bundledSpecification.info?.license),
    externalDocsDefined: Boolean(bundledSpecification.externalDocs),
    allServersDescribed: (bundledSpecification.servers ?? []).every(
      (server) => !server || typeof server !== "object" || Boolean(server.description),
    ),
    placeholderCount,
    blankDescriptionCount: countMatches(rawText, /description:\s*\n/gu),
    publicLiveCaptureDescriptionCount: operations.filter(
      (operation) => (
        typeof operation?.description === "string"
        && /^Live-captured from the authenticated/iu.test(operation.description.trim())
      ),
    ).length,
    headerProfileCount: Object.keys(headerProfiles).length,
    operationContextCount: operationContextRecords.length,
    requestExampleCount,
    successResponseExampleCount,
    evidenceMentionCount,
  };

  return {
    ...quality,
    maturity: getDocumentationMaturity(quality),
  };
}

export async function buildSpecQuality() {
  const entries = await readdir(specificationsDir, { withFileTypes: true });
  const qualityByTitle = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const specRelativePath = path
      .join("specifications", entry.name, "specification", "openapi.yml");
    const specPath = path.join(repoRoot, specRelativePath);
    const specificationDir = path.dirname(specPath);
    const bundledSpecification = await loadBundledSpecification(specPath);
    const moduleEntries = await readdir(specificationDir, { withFileTypes: true });
    const rawTextParts = await Promise.all(
      moduleEntries
        .filter((moduleEntry) => moduleEntry.isFile() && moduleEntry.name.endsWith(".yml"))
        .map((moduleEntry) => readFile(path.join(specificationDir, moduleEntry.name), "utf8")),
    );
    const quality = buildQualityRecord(specRelativePath, bundledSpecification, rawTextParts.join("\n"));
    qualityByTitle[quality.title] = quality;
  }

  return qualityByTitle;
}

export async function buildSpecInventory() {
  const entries = await readdir(specificationsDir, { withFileTypes: true });
  const inventory = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const specRelativePath = path
      .join("specifications", entry.name, "specification", "openapi.yml");
    const specPath = path.join(repoRoot, specRelativePath);
    const bundledSpecification = await loadBundledSpecification(specPath);

    inventory.push({
      title: bundledSpecification.info?.title ?? entry.name,
      specId: entry.name.replace(/^nodoc-/u, ""),
      specPath: specRelativePath.replaceAll("\\", "/"),
      serverUrls: (bundledSpecification.servers ?? [])
        .map((server) => server?.url)
        .filter((url) => typeof url === "string"),
      pathPrefixes: getPathPrefixes(bundledSpecification),
      operationCount: getOperations(bundledSpecification).length,
      tagNames: (bundledSpecification.tags ?? [])
        .map((tag) => tag?.name)
        .filter((name) => typeof name === "string"),
      nodocRoute:
        typeof bundledSpecification.info?.["x-nodoc-route"] === "string"
          ? bundledSpecification.info["x-nodoc-route"]
          : null,
      nodocCategory:
        typeof bundledSpecification.info?.["x-nodoc-category"] === "string"
          ? bundledSpecification.info["x-nodoc-category"]
          : null,
    });
  }

  return inventory.sort((left, right) => left.title.localeCompare(right.title));
}

export async function buildSpecRouteInventory() {
  const entries = await readdir(specificationsDir, { withFileTypes: true });
  const inventory = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const specRelativePath = path
      .join("specifications", entry.name, "specification", "openapi.yml");
    const specPath = path.join(repoRoot, specRelativePath);
    const bundledSpecification = await loadBundledSpecification(specPath);
    const title = bundledSpecification.info?.title ?? entry.name;
    const {
      headerProfiles,
      operations: operationContextRecords,
    } = getNormalizedOperationContextRecords(bundledSpecification, title);
    const operationContextByKey = new Map(
      operationContextRecords.map((record) => [
        `${record.method} ${record.path}`,
        record.operationContext,
      ]),
    );

    inventory.push({
      title,
      specId: entry.name.replace(/^nodoc-/u, ""),
      specPath: specRelativePath.replaceAll("\\", "/"),
      nodocRoute:
        typeof bundledSpecification.info?.["x-nodoc-route"] === "string"
          ? bundledSpecification.info["x-nodoc-route"]
          : null,
      nodocCategory:
        typeof bundledSpecification.info?.["x-nodoc-category"] === "string"
          ? bundledSpecification.info["x-nodoc-category"]
          : null,
      serverUrls: (bundledSpecification.servers ?? [])
        .map((server) => server?.url)
        .filter((url) => typeof url === "string"),
      pathPrefixes: getPathPrefixes(bundledSpecification),
      operations: getOperationEntries(bundledSpecification).map((entry) => ({
        method: entry.method,
        path: entry.path,
        operationId:
          typeof entry.operation.operationId === "string"
            ? entry.operation.operationId
            : null,
        summary:
          typeof entry.operation.summary === "string"
            ? entry.operation.summary
            : null,
        operationContext:
          operationContextByKey.get(`${entry.method} ${entry.path}`) ?? null,
      })),
      headerProfiles,
    });
  }

  return inventory.sort((left, right) => left.title.localeCompare(right.title));
}

export async function buildOperationLiveCaptureLedger() {
  const entries = await readdir(specificationsDir, { withFileTypes: true });
  const ledger = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const specRelativePath = path
      .join("specifications", entry.name, "specification", "openapi.yml");
    const specPath = path.join(repoRoot, specRelativePath);
    const bundledSpecification = await loadBundledSpecification(specPath);
    const title = bundledSpecification.info?.title ?? entry.name;
    const operations = getOperationEntries(bundledSpecification)
      .map(({ method, operation, path: operationPath }) => {
        const liveCapture = normalizeLiveCaptureMetadata(
          operation["x-nodoc-live-capture"],
          `${title} ${method} ${operationPath}`,
        );

        if (!liveCapture) {
          return null;
        }

        return {
          operationId:
            typeof operation.operationId === "string" ? operation.operationId : null,
          summary:
            typeof operation.summary === "string" ? operation.summary : null,
          method,
          path: operationPath,
          ...liveCapture,
          pageCount: liveCapture.browsedPages.length + liveCapture.additionalPageCount,
        };
      })
      .filter(Boolean);

    if (operations.length === 0) {
      continue;
    }

    ledger.push({
      title,
      specId: entry.name.replace(/^nodoc-/u, ""),
      specPath: specRelativePath.replaceAll("\\", "/"),
      nodocRoute:
        typeof bundledSpecification.info?.["x-nodoc-route"] === "string"
          ? bundledSpecification.info["x-nodoc-route"]
          : null,
      nodocCategory:
        typeof bundledSpecification.info?.["x-nodoc-category"] === "string"
          ? bundledSpecification.info["x-nodoc-category"]
          : null,
      operations,
    });
  }

  return ledger.sort((left, right) => left.title.localeCompare(right.title));
}

export async function buildOperationContextLedger() {
  const entries = await readdir(specificationsDir, { withFileTypes: true });
  const ledger = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const specRelativePath = path
      .join("specifications", entry.name, "specification", "openapi.yml");
    const specPath = path.join(repoRoot, specRelativePath);
    const bundledSpecification = await loadBundledSpecification(specPath);
    const title = bundledSpecification.info?.title ?? entry.name;
    const {
      headerProfiles,
      operations,
    } = getNormalizedOperationContextRecords(bundledSpecification, title);

    if (Object.keys(headerProfiles).length === 0 && operations.length === 0) {
      continue;
    }

    ledger.push({
      title,
      specId: entry.name.replace(/^nodoc-/u, ""),
      specPath: specRelativePath.replaceAll("\\", "/"),
      nodocRoute:
        typeof bundledSpecification.info?.["x-nodoc-route"] === "string"
          ? bundledSpecification.info["x-nodoc-route"]
          : null,
      nodocCategory:
        typeof bundledSpecification.info?.["x-nodoc-category"] === "string"
          ? bundledSpecification.info["x-nodoc-category"]
          : null,
      headerProfiles,
      operations: operations.map(({ method, operation, path: operationPath, operationContext }) => ({
        operationId:
          typeof operation.operationId === "string" ? operation.operationId : null,
        summary:
          typeof operation.summary === "string" ? operation.summary : null,
        method,
        path: operationPath,
        operationContext,
      })),
    });
  }

  return ledger.sort((left, right) => left.title.localeCompare(right.title));
}
