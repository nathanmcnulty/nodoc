import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "postman", "collections");
const npmCommand = "npm";

const collectionDefinitions = [
  {
    name: "Defender",
    spec: "specifications/nodoc-defender-xdr/specification/openapi.yml",
    output: "postman/collections/defender.collection.json",
  },
  {
    name: "M365 Admin",
    spec: "specifications/nodoc-m365-admin/specification/openapi.yml",
    output: "postman/collections/m365-admin.collection.json",
  },
  {
    name: "Exchange",
    spec: "specifications/nodoc-exchange-beta/specification/openapi.yml",
    output: "postman/collections/exchange-beta.collection.json",
  },
  {
    name: "SharePoint",
    spec: "specifications/nodoc-sharepoint-admin/specification/openapi.yml",
    output: "postman/collections/sharepoint-admin.collection.json",
  },
  {
    name: "Teams",
    spec: "specifications/nodoc-teams/specification/openapi.yml",
    output: "postman/collections/teams.collection.json",
  },
  {
    name: "M365 Apps Config",
    spec: "specifications/nodoc-m365-apps-config/specification/openapi.yml",
    output: "postman/collections/m365-apps-config.collection.json",
  },
  {
    name: "M365 Apps Services",
    spec: "specifications/nodoc-m365-apps-services/specification/openapi.yml",
    output: "postman/collections/m365-apps-services.collection.json",
  },
  {
    name: "M365 Apps Inventory",
    spec: "specifications/nodoc-m365-apps-inventory/specification/openapi.yml",
    output: "postman/collections/m365-apps-inventory.collection.json",
  },
  {
    name: "Intune Autopatch",
    spec: "specifications/nodoc-intune-autopatch/specification/openapi.yml",
    output: "postman/collections/intune-autopatch.collection.json",
  },
  {
    name: "Intune Portal",
    spec: "specifications/nodoc-intune-portal/specification/openapi.yml",
    output: "postman/collections/intune-portal.collection.json",
  },
  {
    name: "Power Platform",
    spec: "specifications/nodoc-power-platform/specification/openapi.yml",
    output: "postman/collections/power-platform.collection.json",
  },
  {
    name: "Purview",
    spec: "specifications/nodoc-purview/specification/openapi.yml",
    output: "postman/collections/purview.collection.json",
  },
  {
    name: "Purview Portal",
    spec: "specifications/nodoc-purview-portal/specification/openapi.yml",
    output: "postman/collections/purview-portal.collection.json",
  },
  {
    name: "Security Copilot",
    spec: "specifications/nodoc-security-copilot/specification/openapi.yml",
    output: "postman/collections/security-copilot.collection.json",
  },
  {
    name: "Entra IAM",
    spec: "specifications/nodoc-ibiza-iam/specification/openapi.yml",
    output: "postman/collections/entra-iam.collection.json",
  },
  {
    name: "Entra PIM",
    spec: "specifications/nodoc-entra-pim/specification/openapi.yml",
    output: "postman/collections/entra-pim.collection.json",
  },
  {
    name: "Entra IGA",
    spec: "specifications/nodoc-entra-iga/specification/openapi.yml",
    output: "postman/collections/entra-iga.collection.json",
  },
  {
    name: "Entra IDGov",
    spec: "specifications/nodoc-entra-idgov/specification/openapi.yml",
    output: "postman/collections/entra-idgov.collection.json",
  },
  {
    name: "Entra B2C",
    spec: "specifications/nodoc-entra-b2c/specification/openapi.yml",
    output: "postman/collections/entra-b2c.collection.json",
  },
];

function normalizeCollectionSelector(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function getRequestedCollectionSelectors() {
  const selectors = [
    ...process.argv.slice(2),
    ...(process.env.NODOC_COLLECTIONS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  return new Set(selectors.map(normalizeCollectionSelector));
}

function getDefinitionSelectors(definition) {
  return [
    definition.name,
    path.basename(definition.output, ".json"),
    definition.spec,
  ].map(normalizeCollectionSelector);
}

const requestedCollectionSelectors = getRequestedCollectionSelectors();
const activeCollectionDefinitions = requestedCollectionSelectors.size === 0
  ? collectionDefinitions
  : collectionDefinitions.filter((definition) => (
    getDefinitionSelectors(definition).some((selector) => requestedCollectionSelectors.has(selector))
  ));

if (requestedCollectionSelectors.size > 0 && activeCollectionDefinitions.length === 0) {
  throw new Error(
    `No collections matched: ${Array.from(requestedCollectionSelectors).join(", ")}`,
  );
}

function run(command, args) {
  const commandLine = [command, ...args.map((arg) => {
    if (/[\s"]/u.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }

    return arg;
  })].join(" ");

  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function normalizePath(pathValue) {
  return `/${pathValue.replace(/^\/+/u, "").replace(/\/+/gu, "/")}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function pathTemplateToRegex(pathTemplate) {
  return new RegExp(
    `^${escapeRegex(normalizePath(pathTemplate)).replace(/\\\{[^}]+\\\}/gu, "[^/]+")}$`,
    "u",
  );
}

function buildOperationIndex(openapi) {
  return Object.entries(openapi.paths ?? {}).flatMap(([pathname, pathItem]) => (
    Object.entries(pathItem ?? {})
      .filter(([method]) => ["get", "put", "post", "patch", "delete", "head", "options", "trace"].includes(method))
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        pathRegex: pathTemplateToRegex(pathname),
        responses: operation.responses ?? {},
      }))
  ));
}

function getCollectionPath(request) {
  const requestPath = request?.url?.path;

  if (!Array.isArray(requestPath) || requestPath.length === 0) {
    return null;
  }

  return normalizePath(requestPath.join("/"));
}

function getResponseContentType(response) {
  const contentTypeHeader = response?.header?.find(
    (header) => header.key?.toLowerCase() === "content-type",
  );

  return contentTypeHeader?.value?.split(";")[0]?.trim().toLowerCase() ?? null;
}

function getMediaTypeExample(mediaType) {
  if (!mediaType || typeof mediaType !== "object") {
    return undefined;
  }

  if (Object.hasOwn(mediaType, "example")) {
    return mediaType.example;
  }

  if (mediaType.schema && Object.hasOwn(mediaType.schema, "example")) {
    return mediaType.schema.example;
  }

  return undefined;
}

function formatExampleBody(exampleValue, contentType) {
  if (exampleValue === undefined) {
    return undefined;
  }

  if (contentType === "application/json") {
    if (exampleValue !== null && typeof exampleValue === "object") {
      return JSON.stringify(exampleValue, null, 2);
    }

    return JSON.stringify(exampleValue);
  }

  return String(exampleValue);
}

function visitItems(items, callback, ancestors = []) {
  for (const item of items ?? []) {
    callback(item, ancestors);

    if (item.item) {
      visitItems(item.item, callback, [...ancestors, String(item.name ?? "")]);
    }
  }
}

function normalizeItemName(name) {
  return String(name ?? "").trim();
}

function getItemSignature(item) {
  const method = item.request?.method?.toUpperCase();
  const pathname = getCollectionPath(item.request);

  if (!method || !pathname) {
    return null;
  }

  return `${method} ${pathname}`;
}

function getItemKey(ancestors, item) {
  const signature = getItemSignature(item);

  if (signature) {
    return `request:${signature}`;
  }

  const lineage = [...ancestors, normalizeItemName(item.name)].join(" > ");
  return `folder:${lineage}`;
}

function getResponseKey(itemKey, itemRequest, response) {
  const request = response.originalRequest ?? itemRequest;
  const method = request?.method?.toUpperCase() ?? "";
  const pathname = getCollectionPath(request) ?? "";

  return `${itemKey} :: ${response.code ?? ""} :: ${response.name ?? ""} :: ${method} ${pathname}`;
}

function buildExistingCollectionIndex(collection) {
  const items = new Map();
  const responses = new Map();

  visitItems(collection.item, (item, ancestors) => {
    items.set(getItemKey(ancestors, item), item);

    for (const response of item.response ?? []) {
      responses.set(getResponseKey(getItemKey(ancestors, item), item.request, response), response);
    }
  });

  return {
    postmanId: collection.info?._postman_id,
    items,
    responses,
  };
}

function mergeNamedExamples(currentEntries, previousEntries) {
  if (!Array.isArray(currentEntries)) {
    return currentEntries;
  }

  const previousByKey = new Map(
    (previousEntries ?? []).map((entry) => [entry.key, entry]),
  );

  return currentEntries.map((entry) => {
    const previousEntry = previousByKey.get(entry.key);

    if (!previousEntry || previousEntry.value === undefined) {
      return entry;
    }

    return {
      ...entry,
      value: previousEntry.value,
    };
  });
}

function haveSameEntryKeys(currentEntries, previousEntries) {
  const currentKeys = (currentEntries ?? []).map((entry) => entry.key);
  const previousKeys = (previousEntries ?? []).map((entry) => entry.key);

  return currentKeys.length === previousKeys.length
    && currentKeys.every((key, index) => key === previousKeys[index]);
}

function mergeUrlExamples(currentUrl, previousUrl) {
  if (!currentUrl || !previousUrl) {
    return currentUrl;
  }

  const mergedUrl = {
    ...currentUrl,
  };

  if (Array.isArray(currentUrl.query)) {
    mergedUrl.query = mergeNamedExamples(currentUrl.query, previousUrl.query);
  }

  if (Array.isArray(currentUrl.variable)) {
    mergedUrl.variable = mergeNamedExamples(currentUrl.variable, previousUrl.variable);
  }

  if (
    typeof previousUrl.raw === "string"
    && haveSameEntryKeys(currentUrl.query, previousUrl.query)
    && haveSameEntryKeys(currentUrl.variable, previousUrl.variable)
  ) {
    mergedUrl.raw = previousUrl.raw;
  }

  return mergedUrl;
}

function mergeRequestExamples(currentRequest, previousRequest) {
  if (!currentRequest || !previousRequest) {
    return currentRequest;
  }

  const mergedRequest = {
    ...currentRequest,
  };

  if (currentRequest.url && previousRequest.url) {
    mergedRequest.url = mergeUrlExamples(currentRequest.url, previousRequest.url);
  }

  if (Array.isArray(currentRequest.header)) {
    mergedRequest.header = mergeNamedExamples(currentRequest.header, previousRequest.header);
  }

  if (
    currentRequest.body?.mode === "raw"
    && previousRequest.body?.mode === "raw"
    && typeof previousRequest.body.raw === "string"
  ) {
    mergedRequest.body = {
      ...currentRequest.body,
      raw: previousRequest.body.raw,
    };
  }

  return mergedRequest;
}

function getSpecExampleBody(operations, itemRequest, response) {
  const request = response.originalRequest ?? itemRequest;
  const method = request?.method?.toUpperCase();
  const pathname = getCollectionPath(request);

  if (!method || !pathname) {
    return undefined;
  }

  const operation = operations.find(
    (candidate) => candidate.method === method && candidate.pathRegex.test(pathname),
  );

  if (!operation) {
    return undefined;
  }

  const specResponse = operation.responses[String(response.code)] ?? operation.responses.default;
  const contentType = getResponseContentType(response);
  const mediaTypes = specResponse?.content ?? {};
  const mediaTypeKey = Object.keys(mediaTypes).find(
    (candidate) => candidate.toLowerCase() === contentType,
  ) ?? (Object.keys(mediaTypes).length === 1 ? Object.keys(mediaTypes)[0] : null);

  if (!mediaTypeKey) {
    return undefined;
  }

  const exampleValue = getMediaTypeExample(mediaTypes[mediaTypeKey]);
  return formatExampleBody(exampleValue, mediaTypeKey.toLowerCase());
}

// Preserve stable Postman metadata from the checked-in collection and normalize line endings.
function stabilizeCollection(openapiPath, collectionPath, previousCollection) {
  const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));
  const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
  const operations = buildOperationIndex(openapi);
  const previousIndex = previousCollection ? buildExistingCollectionIndex(previousCollection) : null;

  if (previousIndex?.postmanId) {
    collection.info._postman_id = previousIndex.postmanId;
  }

  visitItems(collection.item, (item, ancestors) => {
    const itemKey = getItemKey(ancestors, item);
    const previousItem = previousIndex?.items.get(itemKey);

    if (previousItem?.id) {
      item.id = previousItem.id;
    }

    if (previousItem?.request && item.request) {
      item.request = mergeRequestExamples(item.request, previousItem.request);
    }

    for (const response of item.response ?? []) {
      const previousResponse = previousIndex?.responses.get(
        getResponseKey(itemKey, item.request, response),
      );

      if (previousResponse?.id) {
        response.id = previousResponse.id;
      }

      if (previousResponse?.originalRequest && response.originalRequest) {
        response.originalRequest = mergeRequestExamples(
          response.originalRequest,
          previousResponse.originalRequest,
        );
      }

      const body = getSpecExampleBody(operations, item.request, response);

      if (body !== undefined) {
        response.body = body;
        continue;
      }

      if (previousResponse && previousResponse.body !== undefined) {
        response.body = previousResponse.body;
      }
    }
  });

  writeFileSync(collectionPath, `${JSON.stringify(collection, null, 4)}\n`);
}

mkdirSync(outputDir, { recursive: true });

const tempDir = mkdtempSync(path.join(os.tmpdir(), "nodoc-postman-"));

try {
  for (const definition of activeCollectionDefinitions) {
    const collectionPath = path.join(repoRoot, definition.output);
    const previousCollection = existsSync(collectionPath)
      ? JSON.parse(readFileSync(collectionPath, "utf8"))
      : null;
    const bundledJsonPath = path.join(
      tempDir,
      `${path.basename(definition.output, ".json")}.bundled.json`,
    );

    console.log(`\n==> Generating ${definition.name}`);

    run(npmCommand, [
      "exec",
      "--yes",
      "--package=@redocly/cli@latest",
      "--",
      "redocly",
      "bundle",
      definition.spec,
      "--ext",
      "json",
      "-o",
      bundledJsonPath,
    ]);

    run(npmCommand, [
      "exec",
      "--yes",
      "--package=openapi-to-postmanv2@6.0.0",
      "--",
      "openapi2postmanv2",
      "-s",
      bundledJsonPath,
      "-o",
      definition.output,
      "-p",
      "-c",
      "postman_to_openapi.json",
    ]);

    stabilizeCollection(bundledJsonPath, collectionPath, previousCollection);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
