import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    name: "Purview",
    spec: "specifications/nodoc-purview/specification/openapi.yml",
    output: "postman/collections/purview.collection.json",
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

function visitItems(items, callback) {
  for (const item of items ?? []) {
    callback(item);

    if (item.item) {
      visitItems(item.item, callback);
    }
  }
}

// openapi-to-postman drops top-level falsy primitive examples like `false` and `0`.
function patchEmptyResponseExamples(openapiPath, collectionPath) {
  const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));
  const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
  const operations = buildOperationIndex(openapi);
  let changed = false;

  visitItems(collection.item, (item) => {
    for (const response of item.response ?? []) {
      if (response.body !== "") {
        continue;
      }

      const request = response.originalRequest ?? item.request;
      const method = request?.method?.toUpperCase();
      const pathname = getCollectionPath(request);

      if (!method || !pathname) {
        continue;
      }

      const operation = operations.find(
        (candidate) => candidate.method === method && candidate.pathRegex.test(pathname),
      );

      if (!operation) {
        continue;
      }

      const specResponse = operation.responses[String(response.code)] ?? operation.responses.default;
      const contentType = getResponseContentType(response);
      const mediaTypes = specResponse?.content ?? {};
      const mediaTypeKey = Object.keys(mediaTypes).find(
        (candidate) => candidate.toLowerCase() === contentType,
      ) ?? (Object.keys(mediaTypes).length === 1 ? Object.keys(mediaTypes)[0] : null);

      if (!mediaTypeKey) {
        continue;
      }

      const exampleValue = getMediaTypeExample(mediaTypes[mediaTypeKey]);
      const body = formatExampleBody(exampleValue, mediaTypeKey.toLowerCase());

      if (body === undefined) {
        continue;
      }

      response.body = body;
      changed = true;
    }
  });

  if (changed) {
    writeFileSync(collectionPath, `${JSON.stringify(collection, null, 4)}\n`);
  }
}

mkdirSync(outputDir, { recursive: true });

const tempDir = mkdtempSync(path.join(os.tmpdir(), "nodoc-postman-"));

try {
  for (const definition of collectionDefinitions) {
    const bundledYamlPath = path.join(
      tempDir,
      `${path.basename(definition.output, ".json")}.bundled.yaml`,
    );
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
      "-o",
      bundledYamlPath,
    ]);

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
      bundledYamlPath,
      "-o",
      definition.output,
      "-p",
      "-c",
      "postman_to_openapi.json",
    ]);

    patchEmptyResponseExamples(bundledJsonPath, path.join(repoRoot, definition.output));
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
