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

function getOperations(specification) {
  return Object.values(specification.paths ?? {}).flatMap((pathItem) => (
    Object.entries(pathItem ?? {})
      .filter(([method, operation]) => httpMethods.has(method) && operation && typeof operation === "object")
      .map(([, operation]) => operation)
  ));
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
    const fileSystem = await load(specPath, {
      plugins: [readFiles()],
    });
    const bundledSpecification = bundleSpecification(fileSystem);
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
