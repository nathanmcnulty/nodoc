import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";
import { ancestor } from "acorn-walk";
import fg from "fast-glob";

const httpMethods = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const endpointPropertyNames = new Set([
  "apipath",
  "endpoint",
  "endpointurl",
  "path",
  "route",
  "routepath",
  "uri",
  "url",
]);
const analyzerVersion = "2";
const schemaVersion = 2;
const wrapperNames = new Set(["axios", "client", "fetch", "http", "request"]);
const confidence = {
  exact: 1,
  inferred: 0.8,
  fallback: 0.6,
  parseFallback: 0.4,
};
const maxExpressionDepth = 6;
const maxGraphqlOperations = 100;

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
  let baseUrl = null;
  let hostname = null;

  try {
    if (/^https?:\/\//iu.test(candidate)) {
      const parsed = new URL(candidate);
      baseUrl = parsed.origin;
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

  return { baseUrl, candidatePath: candidate, hostname };
}

function propertyName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "NewExpression" && memberName(node.callee) === "XMLHttpRequest") {
    return evaluated("", confidence.exact, "xml-http-request-instance");
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
  if (node.type !== "MemberExpression" || (node.computed && node.property.type !== "Literal")) {
    return null;
  }
  const objectName = memberName(node.object);
  const property = propertyName(node.property);
  return [objectName, property].filter(Boolean).join(".");
}

function evaluated(text, candidateConfidence, provenance, extras = {}) {
  return {
    baseUrl: extras.baseUrl ?? null,
    confidence: candidateConfidence,
    hostname: extras.hostname ?? null,
    provenance,
    staticValue: extras.staticValue,
    text,
  };
}

function expressionValue(node, context, depth = 0) {
  if (!node || depth > maxExpressionDepth) {
    return null;
  }

  if (node.type === "Literal" && ["boolean", "number", "string"].includes(typeof node.value)) {
    return evaluated(String(node.value), confidence.exact, "literal", {
      staticValue: node.value,
    });
  }

  if (node.type === "Identifier") {
    if (context.reassigned?.has(node.name)) {
      return null;
    }
    const value = context.constants.get(node.name);
    return value
      ? {
          ...value,
          confidence: Math.min(value.confidence, confidence.inferred),
          provenance: `const:${node.name}->${value.provenance}`,
        }
      : null;
  }

  if (node.type === "MemberExpression") {
    const object = expressionValue(node.object, context, depth + 1);
    const property = propertyName(node.property);
    const value = object?.properties?.get(property);
    return value
      ? {
          ...value,
          confidence: Math.min(value.confidence, confidence.inferred),
          provenance: `property:${memberName(node)}->${value.provenance}`,
        }
      : null;
  }

  if (node.type === "ObjectExpression") {
    const properties = new Map();
    for (const property of node.properties) {
      if (
        property.type !== "Property"
        || (property.computed && property.key.type !== "Literal")
      ) {
        continue;
      }

      if (node.type === "ArrayExpression") {
        const values = node.elements.map((element) => expressionValue(element, context, depth + 1));
        if (values.some((value) => !value)) {
          return null;
        }
        return evaluated(values.map((value) => value.text).join(","), confidence.inferred, "array-literal", {
          values,
        });
      }
      const key = propertyName(property.key);
      const value = expressionValue(property.value, context, depth + 1);
      if (key && value) {
        properties.set(key, value);
      }
    }
    return properties.size > 0
      ? {
          confidence: confidence.inferred,
          properties,
          provenance: "object-literal",
          text: "",
        }
      : null;
  }

  if (node.type === "TemplateLiteral") {
    let text = "";
    let candidateConfidence = confidence.exact;
    const provenance = [];
    for (let index = 0; index < node.quasis.length; index += 1) {
      text += node.quasis[index].value.cooked ?? node.quasis[index].value.raw;
      if (index >= node.expressions.length) {
        continue;
      }
      const value = expressionValue(node.expressions[index], context, depth + 1);
      if (value?.staticValue !== undefined || value?.text) {
        text += value.text;
        candidateConfidence = Math.min(candidateConfidence, value.confidence);
        provenance.push(value.provenance);
      } else {
        text += "{param}";
        candidateConfidence = Math.min(candidateConfidence, confidence.inferred);
        provenance.push("dynamic-placeholder");
      }
    }
    return evaluated(
      text,
      candidateConfidence,
      `template:${provenance.join("+") || "static"}`,
    );
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = expressionValue(node.left, context, depth + 1);
    const right = expressionValue(node.right, context, depth + 1);
    if (!left && !right) {
      return null;
    }
    return evaluated(
      `${left?.text ?? "{param}"}${right?.text ?? "{param}"}`,
      Math.min(left?.confidence ?? confidence.fallback, right?.confidence ?? confidence.fallback),
      `binary:${left?.provenance ?? "dynamic"}+${right?.provenance ?? "dynamic"}`,
      {
        baseUrl: left?.baseUrl ?? right?.baseUrl,
        hostname: left?.hostname ?? right?.hostname,
      },
    );
  }

  if (node.type === "UnaryExpression" && node.operator === "!") {
    const argument = expressionValue(node.argument, context, depth + 1);
    if (argument?.staticValue === undefined) {
      return null;
    }
    const value = !argument.staticValue;
    return evaluated(String(value), confidence.inferred, `unary:${argument.provenance}`, {
      staticValue: value,
    });
  }

  if (node.type === "ConditionalExpression") {
    const test = expressionValue(node.test, context, depth + 1);
    if (test?.staticValue === undefined) {
      return null;
    }
    const branch = test.staticValue ? node.consequent : node.alternate;
    const value = expressionValue(branch, context, depth + 1);
    return value
      ? {
          ...value,
          confidence: Math.min(value.confidence, confidence.inferred),
          provenance: `conditional:${test.staticValue ? "consequent" : "alternate"}->${value.provenance}`,
        }
      : null;
  }

  if (node.type === "LogicalExpression") {
    const left = expressionValue(node.left, context, depth + 1);
    if (left?.staticValue === undefined) {
      return null;
    }
    const selectRight = node.operator === "&&" ? Boolean(left.staticValue) : !left.staticValue;
    const value = selectRight
      ? expressionValue(node.right, context, depth + 1)
      : left;
    return value
      ? {
          ...value,
          confidence: Math.min(value.confidence, confidence.inferred),
          provenance: `logical:${node.operator}->${value.provenance}`,
        }
      : null;
  }

  const isUrlConstructor = (
    node.type === "NewExpression"
    || node.type === "CallExpression"
  ) && memberName(node.callee) === "URL";
  if (isUrlConstructor) {
    const route = expressionValue(node.arguments[0], context, depth + 1);
    const base = expressionValue(node.arguments[1], context, depth + 1);
    if (!route?.text) {
      return null;
    }
    try {
      const url = base?.text ? new URL(route.text, base.text) : new URL(route.text);
      return evaluated(
        `${url.pathname}${url.search}`,
        Math.min(route.confidence, base?.confidence ?? confidence.exact),
        `url-constructor:${route.provenance}${base ? `+${base.provenance}` : ""}`,
        { baseUrl: url.origin, hostname: url.hostname.toLowerCase() },
      );
    } catch {
      return route.text.startsWith("/")
        ? {
            ...route,
            provenance: `url-constructor:${route.provenance}`,
          }
        : null;
    }
  }

  return null;
}

function collectStaticContext(ast) {
  const context = {
    aliases: new Map(),
    clientBases: new Map(),
    constants: new Map(),
    xhrInstances: new Set(),
    reassigned: new Set(),
  };
  const declarations = [];

  ancestor(ast, {
    VariableDeclarator(node, ancestors) {
      const declaration = ancestors.at(-2);
      if (node.id.type === "Identifier" && declaration?.type === "VariableDeclaration" && declaration.kind !== "const") {
        context.reassigned.add(node.id.name);
      }
      if (declaration?.type === "VariableDeclaration" && declaration.kind === "const") {
        declarations.push(node);
      }
    },
    AssignmentExpression(node) {
      if (node.left.type === "Identifier") {
        context.reassigned.add(node.left.name);
      }
    },
  });

  for (let pass = 0; pass < maxExpressionDepth; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (declaration.id.type !== "Identifier" || !declaration.init) {
        continue;
      }
      const name = declaration.id.name;
      if (declaration.init.type === "Identifier" && declaration.init.name === name) {
        context.reassigned.add(name);
      }
      const value = expressionValue(declaration.init, context);
      if (value && !context.constants.has(name)) {
        context.constants.set(name, value);
        changed = true;
      }

      const directAlias = memberName(declaration.init);
      if (declaration.init.type === "Identifier") {
        const resolved = context.aliases.get(declaration.init.name) ?? declaration.init.name;
        if (wrapperNames.has(resolved.split(".")[0].toLowerCase()) || resolved === "fetch") {
          context.aliases.set(name, resolved);
        }
      }
      if (directAlias) {
        const root = directAlias.split(".")[0];
        const resolved = context.aliases.get(root) ?? directAlias;
        if (wrapperNames.has(resolved.split(".")[0].toLowerCase())) {
          context.aliases.set(name, resolved);
        }
      }

      if (
        declaration.init.type === "CallExpression"
        && memberName(declaration.init.callee)?.toLowerCase().endsWith(".create")
      ) {
        const owner = memberName(declaration.init.callee).split(".")[0];
        const resolvedOwner = context.aliases.get(owner) ?? owner;
        if (wrapperNames.has(resolvedOwner.toLowerCase())) {
          context.aliases.set(name, resolvedOwner);
          const options = expressionValue(declaration.init.arguments[0], context);
          const base = options?.properties?.get("baseURL")
            ?? options?.properties?.get("baseUrl");
          if (base?.text) {
            context.clientBases.set(name, base);
          }
        }
      }

      if (
        declaration.init.type === "NewExpression"
        && memberName(declaration.init.callee) === "XMLHttpRequest"
      ) {
        context.xhrInstances.add(name);
      }
    }
    if (!changed) {
      break;
    }
  }

  return context;
}

function methodDescriptorFromOptions(node, context) {
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
    const method = expressionValue(property.value, context)?.text.toUpperCase();
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
  const source = String(value?.text ?? value ?? "");
  const paths = new Set();

  for (const prefix of prefixes) {
    let index = source.indexOf(prefix);
    while (index >= 0) {
      if (/^https?:\/\//iu.test(source)) {
        const cleaned = cleanCandidatePath(source);
        if (cleaned && prefixes.some((prefix) => cleaned.candidatePath.startsWith(prefix))) {
          paths.add(JSON.stringify({
            ...cleaned,
            baseUrl: cleaned.baseUrl ?? value?.baseUrl ?? null,
            hostname: cleaned.hostname ?? value?.hostname ?? null,
          }));
        }
        break;
      }
      const fragment = source.slice(index).split(/[\s<>"'`\\|]/u, 1)[0];
      const cleaned = cleanCandidatePath(fragment);
      if (cleaned) {
        paths.add(JSON.stringify({
          ...cleaned,
          baseUrl: cleaned.baseUrl ?? value?.baseUrl ?? null,
          hostname: cleaned.hostname ?? value?.hostname ?? null,
        }));
      }

      index = source.indexOf(prefix, index + prefix.length);
    }
  }

  return Array.from(paths, (candidate) => JSON.parse(candidate));
}

function normalizeMethod(value) {
  const method = String(value || "").toUpperCase();
  return httpMethods.has(method) ? method : null;
}

function parseGraphqlOperations(source, ast, context) {
  const operations = new Map();
  const matcher = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=\{)/gu;
  for (const match of source.matchAll(matcher)) {
    const name = match[2];
    const key = `${match[1]} ${name}`;
    operations.set(key, {
      confidence: confidence.exact,
      name,
      operationType: match[1],
      provenance: "graphql-document",
    });
  }
  if (ast) {
    ancestor(ast, {
      ObjectExpression(node) {
        const object = expressionValue(node, context);
        const operationName = object?.properties?.get("operationName")?.text
          ?? object?.properties?.get("name")?.text;
        const persistedQueryHash = object?.properties?.get("sha256Hash")?.text
          ?? object?.properties?.get("persistedQueryHash")?.text;
        if (!operationName && !persistedQueryHash) {
          return;
        }
        if (persistedQueryHash && !/^[a-f0-9]{32,128}$/iu.test(persistedQueryHash)) {
          return;
        }
        const matches = Array.from(operations.values()).filter((operation) => (
          !operationName || operation.name === operationName
        ));
        if (matches.length === 0 && operationName) {
          operations.set(`query ${operationName}`, {
            confidence: confidence.inferred,
            name: operationName,
            operationType: "query",
            provenance: "graphql-persisted-query-object",
            ...(persistedQueryHash ? { persistedQueryHash: persistedQueryHash.toLowerCase() } : {}),
          });
          return;
        }
        for (const operation of matches) {
          if (persistedQueryHash) {
            operation.persistedQueryHash = persistedQueryHash.toLowerCase();
          }
          operation.confidence = Math.min(operation.confidence, confidence.inferred);
          operation.provenance = `${operation.provenance}+persisted-query-object`;
        }
      },
    });
  }
  return Array.from(operations.values()).slice(0, maxGraphqlOperations).sort((left, right) =>
    `${left.operationType} ${left.name ?? ""} ${left.persistedQueryHash ?? ""}`
      .localeCompare(`${right.operationType} ${right.name ?? ""} ${right.persistedQueryHash ?? ""}`));
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
    for (const extracted of extractCandidatePaths(value, prefixes)) {
      const method = normalizeMethod(details.method);
      const occurrenceId = details.occurrenceId ?? `line:${details.line ?? "unknown"}`;
      const discoveryKind = details.discoveryKind ?? "string-literal";
      const key = `${method ?? "ANY"} ${extracted.hostname ?? "NO_HOST"} ${extracted.candidatePath} ${discoveryKind === "fetch-call" ? occurrenceId : "shared"}`;
      const existing = candidates.get(key);
      const candidate = {
        baseUrl: extracted.baseUrl,
        candidatePath: extracted.candidatePath,
        confidence: details.confidence ?? value?.confidence ?? confidence.fallback,
        discoveryKind,
        hostname: extracted.hostname,
        line: details.line ?? null,
        method,
        occurrenceId,
        provenance: details.provenance ?? value?.provenance ?? "literal-scan",
        reason: details.reason ?? value?.reason ?? null,
        sourceFile,
      };
      if (!existing || (candidate.line ?? Number.MAX_SAFE_INTEGER) < (existing.line ?? Number.MAX_SAFE_INTEGER)) {
        candidates.set(key, candidate);
      }
    }
  }

  let context = {
    aliases: new Map(),
    clientBases: new Map(),
    constants: new Map(),
    xhrInstances: new Set(),
    reassigned: new Set(),
  };
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
    context = collectStaticContext(ast);
    ancestor(ast, {
      CallExpression(node) {
        const callee = memberName(node.callee);
        const lowerCallee = callee?.toLowerCase() ?? "";
        const rootName = lowerCallee.split(".")[0];
        const resolvedRoot = context.aliases.get(rootName)?.toLowerCase() ?? rootName;
        const resolvedRootName = resolvedRoot.split(".")[0];
        const directMethod = normalizeMethod(lowerCallee.split(".").at(-1));
        const isFetch = lowerCallee === "fetch"
          || lowerCallee.endsWith(".fetch")
          || (lowerCallee.split(".").length === 1 && resolvedRoot === "fetch");
        const isHttpClientCall = directMethod && (
          wrapperNames.has(resolvedRootName)
          || wrapperNames.has(rootName)
        );
        const isRequestWrapper = (
          lowerCallee.split(".").length === 1
          && ["axios", "http", "request"].includes(resolvedRootName)
        );
        const isXhrOpen = lowerCallee.endsWith(".open")
          && context.xhrInstances.has(rootName);
        const targetNode = node.arguments[isXhrOpen ? 1 : 0];
        let target = expressionValue(targetNode, context);
        let methodDescriptor = methodDescriptorFromOptions(node.arguments[1], context);
        let method = directMethod;

        if (isXhrOpen) {
          method = normalizeMethod(expressionValue(node.arguments[0], context)?.text);
        } else if (isFetch || isRequestWrapper) {
          method = methodDescriptor.found
            ? methodDescriptor.method
            : isFetch
              ? node.arguments.length === 1 ? "GET" : null
              : null;
        }

        if (isRequestWrapper && node.arguments[0]?.type === "ObjectExpression") {
          const requestOptions = expressionValue(node.arguments[0], context);
          target = requestOptions?.properties?.get("url")
            ?? requestOptions?.properties?.get("uri")
            ?? null;
          method = normalizeMethod(
            requestOptions?.properties?.get("method")?.text
            ?? requestOptions?.properties?.get("httpMethod")?.text,
          );
        }

        const clientBase = context.clientBases.get(rootName)
          ?? context.clientBases.get(resolvedRootName);
        if (target?.text && clientBase?.text && !/^https?:\/\//iu.test(target.text)) {
          try {
            const url = new URL(target.text, clientBase.text);
            target = {
              ...target,
              baseUrl: url.origin,
              hostname: url.hostname.toLowerCase(),
              provenance: `client-base:${clientBase.provenance}->${target.provenance}`,
            };
          } catch {
            // Invalid static base URLs are ignored rather than guessed.
          }

          if (target?.text && /^https?:\/\//iu.test(target.text)) {
            const absolute = cleanCandidatePath(target.text);
            if (absolute) {
              target = { ...target, ...absolute };
            }
          }
        }

        if (target && (isFetch || isHttpClientCall || isRequestWrapper || isXhrOpen)) {
          addCandidate(target, {
            discoveryKind: isXhrOpen
              ? "xmlhttprequest-open"
              : isFetch
                ? "fetch-call"
                : "http-client-call",
            line: lineForNode(node),
            method,
            occurrenceId: `${targetNode?.start ?? node.start}:${targetNode?.end ?? node.end}`,
          });
        }
      },
      Literal(node, ancestors) {
        if (typeof node.value === "string") {
          const parent = ancestors.at(-2);
          if (
            parent?.type === "AssignmentExpression"
            && parent.left.type === "Identifier"
            && context.reassigned.has(parent.left.name)
            || parent?.type === "VariableDeclarator"
            && context.reassigned.has(parent.id.name)
          ) {
            return;
          }
          addCandidate(node.value, {
            confidence: confidence.exact,
            discoveryKind: "string-literal",
            line: lineForNode(node),
            occurrenceId: `${node.start}:${node.end}`,
            provenance: "literal",
            reason: "static-string-match",
          });
        }
      },
      Property(node, ancestors) {
        const key = propertyName(node.key)?.toLowerCase();
        if (!endpointPropertyNames.has(key)) {
          return;
        }
        const value = expressionValue(node.value, context);
        if (!value) {
          return;
        }
        const parent = ancestors.at(-2);
        const parentMethod = parent?.type === "ObjectExpression"
          ? methodFromOptions(parent, context)
          : null;
        addCandidate(value, {
          discoveryKind: "endpoint-property",
          line: lineForNode(node),
          method: parentMethod,
          occurrenceId: `${node.value.start}:${node.value.end}`,
        });
      },
      TemplateLiteral(node) {
        const value = expressionValue(node, context);
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
        addCandidate(match[0], {
          confidence: confidence.parseFallback,
          discoveryKind: "parse-fallback",
          provenance: "parse-fallback",
          reason: "parser-rejected-source; regex-only bounded fallback",
        });
      }
    }
  }

  const methodSpecificPaths = new Set(
    Array.from(candidates.values())
      .filter((candidate) => candidate.method)
      .filter((candidate) => candidate.discoveryKind !== "fetch-call" && candidate.discoveryKind !== "http-client-call")
      .map((candidate) => candidate.candidatePath),
  );

  const filteredCandidates = Array.from(candidates.values())
      .filter((candidate) => (
        candidate.method
        || !['string-literal', 'template-literal', 'endpoint-property'].includes(candidate.discoveryKind)
        || !methodSpecificPaths.has(candidate.candidatePath)
      ));
  const methodSpecificCandidateKeys = new Set(
    filteredCandidates
      .filter((candidate) => candidate.method)
      .map((candidate) => `${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath} ${candidate.line}`),
  );
  const filteredByMethod = filteredCandidates.filter((candidate) => (
    candidate.method
    || candidate.discoveryKind !== "fetch-call"
    || !methodSpecificCandidateKeys.has(`${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath} ${candidate.line}`)
  ));
  const nonSpecificByPath = new Map();
  for (const candidate of filteredByMethod) {
    if (!candidate.method) {
      nonSpecificByPath.set(candidate.candidatePath, candidate);
    }
  }
  const deduplicatedCandidates = new Map();
  for (const candidate of filteredByMethod) {
    const key = `${candidate.method ?? "ANY"} ${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath}`;
    const existing = deduplicatedCandidates.get(key);
    if (!existing || (candidate.line ?? Number.MAX_SAFE_INTEGER) < (existing.line ?? Number.MAX_SAFE_INTEGER)) {
      deduplicatedCandidates.set(key, candidate);
    }
  }
  const fetchCallPathCounts = new Map();
  for (const candidate of candidates.values()) {
    if (candidate.discoveryKind === "fetch-call") {
      fetchCallPathCounts.set(candidate.candidatePath, (fetchCallPathCounts.get(candidate.candidatePath) ?? 0) + 1);
    }
  }
  for (const candidate of candidates.values()) {
    if (!candidate.method && candidate.discoveryKind === "fetch-call" && (fetchCallPathCounts.get(candidate.candidatePath) ?? 0) > 1) {
      deduplicatedCandidates.set(`ANY ${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath}`, candidate);
    }
  }
  for (const candidate of Array.from(deduplicatedCandidates.values())) {
    if (candidate.method) {
      const ambiguous = deduplicatedCandidates.get(`ANY ${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath}`);
      if (ambiguous && ambiguous.line === candidate.line && ambiguous.discoveryKind !== "fetch-call") {
        deduplicatedCandidates.delete(`ANY ${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath}`);
      }
    }
  }
  for (const candidate of Array.from(deduplicatedCandidates.values())) {
    if (candidate.method) {
      const ambiguousKey = `ANY ${candidate.hostname ?? "NO_HOST"} ${candidate.candidatePath}`;
      const ambiguous = deduplicatedCandidates.get(ambiguousKey);
      if (ambiguous && ambiguous.discoveryKind !== "fetch-call") {
        deduplicatedCandidates.delete(ambiguousKey);
      }
    }
  }

  return {
    analyzerVersion,
    candidates: Array.from(deduplicatedCandidates.values())
      .map(({ occurrenceId: _occurrenceId, ...candidate }) => candidate)
      .sort((left, right) =>
      `${left.candidatePath} ${left.method ?? ""} ${left.hostname ?? ""}`.localeCompare(
        `${right.candidatePath} ${right.method ?? ""} ${right.hostname ?? ""}`,
      )),
    graphqlOperations: parseGraphqlOperations(source, ast, context).map((operation) => ({
      ...operation,
      sourceFile,
    })),
    parseError,
    schemaVersion,
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
    analyzerVersion,
    bundleCount: results.length,
    candidates: Array.from(candidateMap.values()).sort((left, right) =>
      `${left.hostname ?? ""} ${left.candidatePath} ${left.method ?? ""} ${left.sourceFile}`
        .localeCompare(`${right.hostname ?? ""} ${right.candidatePath} ${right.method ?? ""} ${right.sourceFile}`)),
    graphqlOperations: Array.from(graphqlMap.values()).sort((left, right) =>
      `${left.operationType} ${left.name ?? ""} ${left.sourceFile}`
        .localeCompare(`${right.operationType} ${right.name ?? ""} ${right.sourceFile}`)),
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
    schemaVersion,
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
