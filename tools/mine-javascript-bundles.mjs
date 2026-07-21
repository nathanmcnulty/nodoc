import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";
import { ancestor } from "acorn-walk";
import fg from "fast-glob";

const httpMethods = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const endpointPropertyNames = new Set([
  "endpoint",
  "endpointurl",
  "path",
  "route",
  "uri",
  "url",
]);

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function normalizePrefix(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function cleanCandidatePath(value) {
  let candidate = String(value || "")
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u002f", "/")
    .trim();

  try {
    if (/^https?:\/\//iu.test(candidate)) {
      const parsed = new URL(candidate);
      candidate = `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }

  candidate = candidate
    .split("#", 1)[0]
    .replace(/[)"'`,;\]]+$/u, "")
    .replace(/\/{2,}/gu, "/");

  if (!candidate.startsWith("/")) {
    return null;
  }

  return candidate;
}

function expressionValue(node) {
  if (!node) {
    return null;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (node.type === "TemplateLiteral") {
    return node.quasis
      .map((quasi, index) => {
        const suffix = index < node.expressions.length ? "{param}" : "";
        return `${quasi.value.cooked ?? quasi.value.raw}${suffix}`;
      })
      .join("");
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = expressionValue(node.left);
    const right = expressionValue(node.right);
    if (left !== null && right !== null) {
      return `${left}${right}`;
    }
    if (left !== null) {
      return `${left}{param}`;
    }
    if (right !== null) {
      return `{param}${right}`;
    }
  }

  return null;
}

function propertyName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "Literal") {
    return String(node.value);
  }
  return null;
}

function memberName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type !== "MemberExpression") {
    return null;
  }
  const objectName = memberName(node.object);
  const property = propertyName(node.property);
  return [objectName, property].filter(Boolean).join(".");
}

function methodDescriptorFromOptions(node) {
  if (!node) {
    return { found: false, method: null };
  }
  if (node.type !== "ObjectExpression") {
    return { found: true, method: null };
  }
  let descriptor = { found: false, method: null };
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      descriptor = { found: true, method: null };
      continue;
    }
    if (property.type !== "Property") {
      continue;
    }
    const key = propertyName(property.key)?.toLowerCase();
    if (
      property.computed
      && !(property.key.type === "Literal" && typeof property.key.value === "string")
    ) {
      descriptor = { found: true, method: null };
      continue;
    }
    if (key !== "method") {
      continue;
    }
    const method = expressionValue(property.value)?.toUpperCase();
    descriptor = {
      found: true,
      method: httpMethods.has(method) ? method : null,
    };
  }
  return descriptor;
}

function methodFromOptions(node) {
  return methodDescriptorFromOptions(node).method;
}

function lineForNode(node) {
  return node?.loc?.start?.line ?? null;
}

function extractCandidatePaths(value, prefixes) {
  const source = String(value || "");
  const paths = new Set();

  for (const prefix of prefixes) {
    let index = source.indexOf(prefix);
    while (index >= 0) {
      const fragment = source.slice(index).split(/[\s<>"'`\\|]/u, 1)[0];
      const candidate = cleanCandidatePath(fragment);
      if (candidate) {
        paths.add(candidate);
      }
      index = source.indexOf(prefix, index + prefix.length);
    }
  }

  return Array.from(paths);
}

function normalizeMethod(value) {
  const method = String(value || "").toUpperCase();
  return httpMethods.has(method) ? method : null;
}

function parseGraphqlOperations(source) {
  const operations = new Map();
  const matcher = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gu;
  for (const match of source.matchAll(matcher)) {
    const key = `${match[1]} ${match[2]}`;
    operations.set(key, {
      name: match[2],
      operationType: match[1],
    });
  }
  return Array.from(operations.values()).sort((left, right) =>
    `${left.operationType} ${left.name}`.localeCompare(`${right.operationType} ${right.name}`));
}

function parseSourceMapUrls(source) {
  const urls = [];
  const matcher = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)/gu;
  for (const match of source.matchAll(matcher)) {
    urls.push(match[1]);
  }
  return uniqueSorted(urls);
}

export function mineBundleSource(source, options = {}) {
  const sourceFile = options.sourceFile ?? "bundle.js";
  const prefixes = uniqueSorted(
    (options.prefixes ?? ["/api/", "/admin/", "/apiproxy/"])
      .map(normalizePrefix)
      .filter(Boolean),
  );
  const candidates = new Map();
  let parseError = null;

  function addCandidate(value, details = {}) {
    for (const candidatePath of extractCandidatePaths(value, prefixes)) {
      const method = normalizeMethod(details.method);
      const occurrenceId = details.occurrenceId ?? `line:${details.line ?? "unknown"}`;
      const key = `${method ?? "ANY"} ${candidatePath} ${occurrenceId}`;
      const existing = candidates.get(key);
      const candidate = {
        candidatePath,
        discoveryKind: details.discoveryKind ?? "string-literal",
        line: details.line ?? null,
        method,
        occurrenceId,
        sourceFile,
      };
      if (!existing || (candidate.line ?? Number.MAX_SAFE_INTEGER) < (existing.line ?? Number.MAX_SAFE_INTEGER)) {
        candidates.set(key, candidate);
      }
    }
  }

  let ast = null;
  try {
    ast = parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      locations: true,
      sourceType: "script",
    });
  } catch (scriptError) {
    try {
      ast = parse(source, {
        allowHashBang: true,
        ecmaVersion: "latest",
        locations: true,
        sourceType: "module",
      });
    } catch (moduleError) {
      parseError = [
        scriptError instanceof Error ? scriptError.message : String(scriptError),
        moduleError instanceof Error ? moduleError.message : String(moduleError),
      ].join(" | module parse: ");
    }
  }

  if (ast) {
    ancestor(ast, {
      CallExpression(node) {
        const callee = memberName(node.callee);
        const lowerCallee = callee?.toLowerCase() ?? "";
        const directMethod = normalizeMethod(lowerCallee.split(".").at(-1));
        const isFetch = lowerCallee === "fetch" || lowerCallee.endsWith(".fetch");
        const isHttpClientCall = directMethod && (
          lowerCallee.includes("axios")
          || lowerCallee.includes("http")
          || lowerCallee.includes("client")
          || lowerCallee.includes("request")
        );
        const target = expressionValue(node.arguments[0]);

        if (target && (isFetch || isHttpClientCall)) {
          const methodDescriptor = methodDescriptorFromOptions(node.arguments[1]);
          addCandidate(target, {
            discoveryKind: isFetch ? "fetch-call" : "http-client-call",
            line: lineForNode(node),
            method: isFetch
              ? methodDescriptor.found
                ? methodDescriptor.method
                : "GET"
              : directMethod,
            occurrenceId: `${node.arguments[0]?.start ?? node.start}:${node.arguments[0]?.end ?? node.end}`,
          });
        }
      },
      Literal(node) {
        if (typeof node.value === "string") {
          addCandidate(node.value, {
            discoveryKind: "string-literal",
            line: lineForNode(node),
            occurrenceId: `${node.start}:${node.end}`,
          });
        }
      },
      Property(node, ancestors) {
        const key = propertyName(node.key)?.toLowerCase();
        if (!endpointPropertyNames.has(key)) {
          return;
        }
        const value = expressionValue(node.value);
        if (!value) {
          return;
        }
        const parent = ancestors.at(-2);
        const parentMethod = parent?.type === "ObjectExpression"
          ? methodFromOptions(parent)
          : null;
        addCandidate(value, {
          discoveryKind: "endpoint-property",
          line: lineForNode(node),
          method: parentMethod,
          occurrenceId: `${node.value.start}:${node.value.end}`,
        });
      },
      TemplateLiteral(node) {
        const value = expressionValue(node);
        if (value) {
          addCandidate(value, {
            discoveryKind: "template-literal",
            line: lineForNode(node),
            occurrenceId: `${node.start}:${node.end}`,
          });
        }
      },
    });
  }

  if (parseError) {
    for (const prefix of prefixes) {
      const matcher = new RegExp(
        `${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[A-Za-z0-9%{}().,'_?=&\\-/]*`,
        "gu",
      );
      for (const match of source.matchAll(matcher)) {
        addCandidate(match[0], { discoveryKind: "parse-fallback" });
      }
    }
  }

  const methodSpecificPaths = new Set(
    Array.from(candidates.values())
      .filter((candidate) => candidate.method)
      .map((candidate) => `${candidate.candidatePath}:${candidate.occurrenceId}`),
  );

  const filteredCandidates = Array.from(candidates.values())
      .filter((candidate) => (
        candidate.method
        || !methodSpecificPaths.has(`${candidate.candidatePath}:${candidate.occurrenceId}`)
      ));
  const deduplicatedCandidates = new Map();
  for (const candidate of filteredCandidates) {
    const key = `${candidate.method ?? "ANY"} ${candidate.candidatePath}`;
    const existing = deduplicatedCandidates.get(key);
    if (!existing || (candidate.line ?? Number.MAX_SAFE_INTEGER) < (existing.line ?? Number.MAX_SAFE_INTEGER)) {
      deduplicatedCandidates.set(key, candidate);
    }
  }

  return {
    candidates: Array.from(deduplicatedCandidates.values())
      .map(({ occurrenceId: _occurrenceId, ...candidate }) => candidate)
      .sort((left, right) =>
      `${left.candidatePath} ${left.method ?? ""}`.localeCompare(
        `${right.candidatePath} ${right.method ?? ""}`,
      )),
    graphqlOperations: parseGraphqlOperations(source).map((operation) => ({
      ...operation,
      sourceFile,
    })),
    parseError,
    sourceFile,
    sourceMapUrls: parseSourceMapUrls(source),
  };
}

export async function mineJavascriptBundles(options) {
  const prefixes = options.prefixes ?? [];
  const results = [];
  for (const bundleFile of options.bundleFiles ?? []) {
    const source = await readFile(bundleFile, "utf8");
    results.push(mineBundleSource(source, {
      prefixes,
      sourceFile: path.basename(bundleFile),
    }));
  }

  const candidateMap = new Map();
  const graphqlMap = new Map();
  for (const result of results) {
    for (const candidate of result.candidates) {
      candidateMap.set(
        `${candidate.method ?? "ANY"} ${candidate.candidatePath} ${candidate.sourceFile}`,
        candidate,
      );
    }
    for (const operation of result.graphqlOperations) {
      graphqlMap.set(
        `${operation.operationType} ${operation.name} ${operation.sourceFile}`,
        operation,
      );
    }
  }

  return {
    bundleCount: results.length,
    candidates: Array.from(candidateMap.values()),
    graphqlOperations: Array.from(graphqlMap.values()),
    parseFailures: results
      .filter((result) => result.parseError)
      .map((result) => ({
        error: result.parseError,
        sourceFile: result.sourceFile,
      })),
    sourceMaps: results.flatMap((result) =>
      result.sourceMapUrls.map((url) => ({
        sourceFile: result.sourceFile,
        url,
      }))),
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveContainedFile(rootDirectory, candidatePath) {
  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(rootDirectory),
      realpath(candidatePath),
    ]);
    const relativePath = path.relative(realRoot, realCandidate);
    if (
      !relativePath
      || relativePath.startsWith(`..${path.sep}`)
      || relativePath === ".."
      || path.isAbsolute(relativePath)
    ) {
      return null;
    }
    return realCandidate;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    artifacts: null,
    bundleDir: null,
    output: null,
    prefixes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--artifacts" && next) {
      args.artifacts = path.resolve(next);
      index += 1;
    } else if (argument === "--bundle-dir" && next) {
      args.bundleDir = path.resolve(next);
      index += 1;
    } else if (argument === "--out" && next) {
      args.output = path.resolve(next);
      index += 1;
    } else if (argument === "--prefix" && next) {
      args.prefixes.push(next);
      index += 1;
    }
  }

  if (!args.artifacts && !args.bundleDir) {
    throw new Error("Provide --artifacts <dir> or --bundle-dir <dir>.");
  }
  args.artifacts ??= args.bundleDir;
  args.bundleDir ??= path.join(args.artifacts, "bundles");
  args.output ??= path.join(args.artifacts, "bundle-candidates.json");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(args.artifacts, "bundle-downloads.json");
  let bundleFiles = [];

  if (await exists(manifestPath)) {
    const downloads = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const entry of downloads) {
      if (!entry?.localPath) {
        continue;
      }
      const containedFile = await resolveContainedFile(
        args.artifacts,
        path.resolve(args.artifacts, entry.localPath),
      );
      if (containedFile) {
        bundleFiles.push(containedFile);
      }
    }
  }

  if (bundleFiles.length === 0) {
    const discoveredFiles = await fg("**/*.{js,mjs}", {
      absolute: true,
      cwd: args.bundleDir,
      onlyFiles: true,
    });
    for (const filePath of discoveredFiles) {
      const containedFile = await resolveContainedFile(args.artifacts, filePath);
      if (containedFile) {
        bundleFiles.push(containedFile);
      }
    }
  }

  const payload = await mineJavascriptBundles({
    bundleFiles,
    prefixes: args.prefixes,
  });
  await writeFile(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    bundleCount: payload.bundleCount,
    candidateCount: payload.candidates.length,
    graphqlOperationCount: payload.graphqlOperations.length,
    output: args.output,
    parseFailureCount: payload.parseFailures.length,
  }, null, 2));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}
