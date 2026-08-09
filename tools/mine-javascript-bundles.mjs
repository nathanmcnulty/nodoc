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
const wrapperFunctionNames = new Set(["fetch", "request", "http", "client", "axios"]);
const httpMethodNames = new Set(["delete", "get", "post", "put", "patch", "head", "options"]);
const conditionalTypes = new Set(["ConditionalExpression", "LogicalExpression"]);

const candidateConfidence = {
  exact: 1.0,
  inferred: 0.8,
  fallback: 0.6,
};

const maxExpressionDepth = 6;

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
  let hostname = null;

  try {
    if (/^https?:\/\//iu.test(candidate)) {
      const parsed = new URL(candidate);
      hostname = parsed.hostname.toLowerCase();
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

  return { candidate, hostname };
}

function isObjectExpression(node) {
  return node && node.type === "ObjectExpression";
}

function objectLiteralMap(node, evaluator) {
  if (!isObjectExpression(node)) {
    return null;
  }

  const values = new Map();
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed) {
      continue;
    }
    const key = propertyName(property.key);
    if (!key) {
      continue;
    }
    const value = evaluator(property.value);
    if (value) {
      values.set(key, value);
    }
  }
  return values.size > 0 ? values : null;
}

function combineHost(baseHost, nextHost) {
  return nextHost || baseHost || null;
}

function evaluateTruthiness(node, evaluator, context, depth = 0) {
  if (!node || depth > maxExpressionDepth) {
    return null;
  }

  if (node.type === "Literal") {
    return Boolean(node.value);
  }

  if (node.type === "Identifier") {
    const constant = context.constants.get(node.name);
    return typeof constant === "boolean" ? constant : null;
  }

  if (node.type === "UnaryExpression" && node.operator === "!") {
    const value = evaluateTruthiness(node.argument, evaluator, context, depth + 1);
    return value === null ? null : !value;
  }

  if (node.type === "UnaryExpression" && node.operator === "typeof") {
    return null;
  }

  if (node.type === "BinaryExpression" && ["===", "==", "!==", "!="].includes(node.operator)) {
    const left = expressionValue(node.left, context, depth + 1)?.candidate;
    const right = expressionValue(node.right, context, depth + 1)?.candidate;
    if (left === undefined || right === undefined) {
      return null;
    }
    return node.operator === "!==" || node.operator === "!=" ? left !== right : left === right;
  }

  return null;
}

function expressionValue(node, context = { constants: new Map() }, depth = 0) {
  if (!node || depth > maxExpressionDepth) {
    return null;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return {
      candidate: node.value,
      confidence: candidateConfidence.exact,
      provenance: "literal",
      hostname: null,
    };
  }

  if (node.type === "Literal" && (typeof node.value === "number" || typeof node.value === "boolean")) {
    return {
      candidate: String(node.value),
      confidence: candidateConfidence.exact,
      provenance: "literal",
      hostname: null,
    };
  }

  if (node.type === "TemplateLiteral") {
    return {
      candidate: node.quasis
      .map((quasi, index) => {
        const expression = node.expressions[index];
        const resolved = expressionValue(expression, context, depth + 1);
        const suffix = index < node.expressions.length
          ? (resolved?.candidate ?? "{param}")
          : "";
        return `${quasi.value.cooked ?? quasi.value.raw}${suffix}`;
      })
      .join(""),
      confidence: node.expressions.every((expression) => expressionValue(expression, context, depth + 1))
        ? candidateConfidence.inferred
        : candidateConfidence.fallback,
      provenance: "template",
      hostname: null,
    };
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = expressionValue(node.left, context, depth + 1);
    const right = expressionValue(node.right, context, depth + 1);
    if (left && right) {
      const merged = cleanCandidatePath(`${left.candidate}${right.candidate}`);
      if (merged) {
        return {
          candidate: merged.candidate,
          confidence: Math.min(left.confidence, right.confidence),
          provenance: "binary",
          hostname: merged.hostname ?? combineHost(left.hostname, right.hostname),
        };
      }
      return {
        candidate: `${left.candidate}${right.candidate}`,
        confidence: Math.min(left.confidence, right.confidence),
        provenance: "binary",
        hostname: combineHost(left.hostname, right.hostname),
      };
    }
    if (left !== null) {
      return {
        candidate: `${left.candidate}{param}`,
        confidence: Math.min(left.confidence, candidateConfidence.fallback),
        provenance: "binary",
        hostname: left.hostname,
      };
    }
    if (right !== null) {
      return {
        candidate: `{param}${right.candidate}`,
        confidence: Math.min(right.confidence, candidateConfidence.fallback),
        provenance: "binary",
        hostname: right.hostname,
      };
    }
  }

  if (node.type === "Identifier") {
    const directValue = context.constants.get(node.name);
    if (!directValue) return null;
    return directValue.candidate
      ? {
          ...directValue,
          confidence: Math.min(directValue.confidence, candidateConfidence.inferred),
          provenance: `identifier:${node.name}:${directValue.provenance}`,
        }
      : null;
  }

  if (node.type === "MemberExpression") {
    const objectName = memberName(node.object);
    if (!objectName) {
      return null;
    }
    const objectValue = context.constants.get(objectName);
    if (objectValue && typeof objectValue === "object" && !Array.isArray(objectValue)) {
      const property = propertyName(node.property);
      if (property && Object.hasOwn(objectValue, property)) {
        const resolved = objectValue[property];
        return resolved?.candidate
          ? {
              ...resolved,
              confidence: Math.min(resolved.confidence, candidateConfidence.inferred),
              provenance: `object-property:${objectName}.${property}:${resolved.provenance}`,
            }
          : null;
      }
    }
  }

  if (node.type === "ConditionalExpression") {
    const result = evaluateTruthiness(node.test, expressionValue, context, depth + 1);
    if (result === null) {
      return null;
    }
    const next = result ? node.consequent : node.alternate;
    const resolved = expressionValue(next, context, depth + 1);
    return resolved ? {
      candidate: resolved.candidate,
      confidence: Math.min(resolved.confidence, candidateConfidence.fallback),
      provenance: `conditional:${resolved.provenance}`,
      hostname: resolved.hostname,
    } : null;
  }

  if (node.type === "LogicalExpression") {
    const truth = evaluateTruthiness(node.left, expressionValue, context, depth + 1);
    if (node.operator === "&&") {
      if (truth === false) return null;
      return expressionValue(node.right, context, depth + 1);
    }
    if (node.operator === "||") {
      if (truth === true) return expressionValue(node.left, context, depth + 1);
      return expressionValue(node.right, context, depth + 1);
    }
    if (node.operator === "??") {
      return expressionValue(node.left, context, depth + 1)
        ?? expressionValue(node.right, context, depth + 1);
    }
  }

  if (node.type === "NewExpression" && memberName(node.callee) === "URL") {
    const pathValue = expressionValue(node.arguments?.[0], context, depth + 1);
    const baseValue = expressionValue(node.arguments?.[1], context, depth + 1);
    if (!pathValue?.candidate) {
      return null;
    }
    if (!baseValue?.candidate && node.arguments?.length === 1) {
      if (/^\//.test(pathValue.candidate)) {
        return {
          candidate: pathValue.candidate,
          confidence: pathValue.confidence,
          provenance: `new-url:${pathValue.provenance}`,
          hostname: null,
        };
      }
      return null;
    }

    if (!baseValue?.candidate || !/^https?:/iu.test(baseValue.candidate)) {
      return null;
    }
    try {
      const merged = new URL(pathValue.candidate, baseValue.candidate);
      return {
        candidate: `${merged.pathname}${merged.search}`,
        confidence: Math.min(pathValue.confidence, baseValue.confidence),
        provenance: `new-url:${pathValue.provenance}+${baseValue.provenance}`,
        hostname: merged.hostname.toLowerCase(),
      };
    } catch {
      return null;
    }
  }

  if (node.type === "CallExpression" && memberName(node.callee)?.toLowerCase() === "url") {
    const value = expressionValue(node.callee.object, context, depth + 1);
    if (!value) {
      return null;
    }
    return value;
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

function methodDescriptorFromOptions(node, context = { constants: new Map() }) {
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
    const value = expressionValue(property.value, context);
    const method = typeof value?.candidate === "string" ? value.candidate.toUpperCase() : null;
    descriptor = {
      found: true,
      method: httpMethods.has(method) ? method : null,
    };
  }
  return descriptor;
}

function methodFromOptions(node, context) {
  return methodDescriptorFromOptions(node, context).method;
}

function lineForNode(node) {
  return node?.loc?.start?.line ?? null;
}

function extractCandidatePaths(value, prefixes) {
  const source = String(value || "");
  const paths = new Map();

  for (const prefix of prefixes) {
    let index = source.indexOf(prefix);
    while (index >= 0) {
      const fragment = source.slice(index).split(/[\s<>"'`\\|]/u, 1)[0];
      const candidate = cleanCandidatePath(fragment);
      if (candidate) {
        paths.set(`${candidate.hostname ?? ""} ${candidate.candidate}`, candidate);
      }
      index = source.indexOf(prefix, index + prefix.length);
    }
  }

  return Array.from(paths.values());
}

function normalizeMethod(value) {
  const method = String(value || "").toUpperCase();
  return httpMethods.has(method) ? method : null;
}

function parseGraphqlOperations(source) {
  const operations = new Map();
  const hashes = Array.from(source.matchAll(/(?:sha256Hash|persistedQuery|queryHash|hash)\s*["']?\s*[:=]\s*["']([a-f0-9]{32,128})["']/giu), (match) => match[1]);
  const matcher = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gu;
  for (const match of source.matchAll(matcher)) {
    const key = `${match[1]} ${match[2]}`;
    const hash = source.match(new RegExp(`(?:sha256|hash|persistedQuery)[^\\n]{0,160}?${match[2]}[^\\n]{0,160}?([a-f0-9]{32,128})`, "iu"))?.[1]
      ?? source.match(new RegExp(`([a-f0-9]{32,128})[^\\n]{0,160}?(?:sha256|hash|persistedQuery)[^\\n]{0,160}?${match[2]}`, "iu"))?.[1]
      ?? (hashes.length === 1 ? hashes[0] : null);
    operations.set(key, {
      name: match[2],
      operationType: match[1],
      persistedQueryHash: hash,
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
  const constants = new Map();
  const aliases = new Set();
  const xhrAliases = new Set(["xmlhttprequest"]);
  let parseError = null;

  function addCandidate(value, details = {}) {
    const values = typeof value === "object" && value?.candidate
      ? (() => {
          const cleaned = cleanCandidatePath(value.candidate);
          return cleaned
            ? [{ ...value, candidate: cleaned.candidate, hostname: value.hostname ?? cleaned.hostname }]
            : [];
        })()
      : extractCandidatePaths(value, prefixes);
    for (const candidateValue of values) {
      const candidatePath = candidateValue.candidate;
      const method = normalizeMethod(details.method);
      const occurrenceId = details.occurrenceId ?? `line:${details.line ?? "unknown"}`;
      const key = `${method ?? "ANY"} ${candidatePath} ${candidateValue.hostname ?? ""} ${occurrenceId}`;
      const existing = candidates.get(key);
      const candidate = {
        candidatePath,
        discoveryKind: details.discoveryKind ?? "string-literal",
        confidence: details.confidence ?? candidateValue.confidence ?? candidateConfidence.fallback,
        hostname: details.hostname ?? candidateValue.hostname ?? null,
        line: details.line ?? null,
        method,
        occurrenceId,
        provenance: details.provenance ?? candidateValue.provenance ?? null,
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
      VariableDeclaration(node) {
        if (node.kind !== "const") {
          return;
        }
        for (const declarator of node.declarations) {
          if (declarator.id?.type !== "Identifier" || !declarator.init) continue;
          const value = expressionValue(declarator.init, { constants });
          if (value) constants.set(declarator.id.name, value);
          if (declarator.init.type === "ObjectExpression") {
            const mapped = objectLiteralMap(
              declarator.init,
              (child) => expressionValue(child, { constants }),
            );
            if (mapped) constants.set(declarator.id.name, Object.fromEntries(mapped));
          }
          if (declarator.init.type === "Identifier" && wrapperFunctionNames.has(declarator.init.name.toLowerCase())) {
            aliases.add(declarator.id.name.toLowerCase());
          }
          if (declarator.init.type === "NewExpression" && memberName(declarator.init.callee)?.toLowerCase() === "xmlhttprequest") {
            xhrAliases.add(declarator.id.name.toLowerCase());
          }
        }
      },
    });
    ancestor(ast, {
      CallExpression(node) {
        const callee = memberName(node.callee);
        const lowerCallee = callee?.toLowerCase() ?? "";
        const directMethod = normalizeMethod(lowerCallee.split(".").at(-1));
        const isFetch = lowerCallee === "fetch" || lowerCallee.endsWith(".fetch");
        const isXhrOpen = lowerCallee.endsWith(".open")
          && xhrAliases.has(lowerCallee.split(".")[0]);
        const isAliasCall = aliases.has(lowerCallee);
        const isHttpClientCall = directMethod && (
          lowerCallee.includes("axios")
          || lowerCallee.includes("http")
          || lowerCallee.includes("client")
          || lowerCallee.includes("request")
          || aliases.has(lowerCallee.split(".")[0])
        );
        const targetArgument = isXhrOpen ? node.arguments[1] : node.arguments[0];
        const target = expressionValue(targetArgument, { constants });

        if (target && (isFetch || isAliasCall || isHttpClientCall || isXhrOpen)) {
          const methodDescriptor = isXhrOpen
            ? { found: true, method: normalizeMethod(expressionValue(node.arguments[0], { constants })?.candidate) }
            : methodDescriptorFromOptions(node.arguments[1], { constants });
          addCandidate(target, {
            discoveryKind: isXhrOpen ? "xhr-open" : isFetch || isAliasCall ? "fetch-call" : "http-client-call",
            line: lineForNode(node),
            method: isXhrOpen
              ? methodDescriptor.method
              : isFetch || isAliasCall
              ? methodDescriptor.found
                ? methodDescriptor.method
                : "GET"
              : directMethod,
            occurrenceId: `${node.arguments[0]?.start ?? node.start}:${node.arguments[0]?.end ?? node.end}`,
          });
        }
      },
      Literal(node, ancestors) {
        if (typeof node.value === "string") {
          const parent = ancestors.at(-2);
          if (parent?.type === "CallExpression" || parent?.type === "BinaryExpression") {
            return;
          }
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
        const value = expressionValue(node.value, { constants });
        if (!value) {
          return;
        }
        const parent = ancestors.at(-2);
        const parentMethod = parent?.type === "ObjectExpression"
          ? methodFromOptions(parent, { constants })
          : null;
        addCandidate(value, {
          discoveryKind: "endpoint-property",
          line: lineForNode(node),
          method: parentMethod,
          occurrenceId: `${node.value.start}:${node.value.end}`,
        });
      },
      TemplateLiteral(node) {
        const value = expressionValue(node, { constants });
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
