import { createServer } from "node:http";
import { findOperation } from "./client.mjs";

function routePattern(route) {
  let parameterCount = 0;
  const segments = route.split("/").map((segment) => {
    if (/^\{[^}]+\}$/u.test(segment)) {
      parameterCount += 1;
      return "([^/]+)";
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  });
  return {
    pattern: new RegExp(`^${segments.join("/")}$`, "u"),
    parameterCount,
    staticSegmentCount: segments.length - parameterCount,
  };
}

export async function startSyntheticMockServer({ specification, examples, onRequest = () => {} }) {
  const operations = Object.keys(examples.responses).map((operationId) => {
    const definition = findOperation(specification, operationId);
    if (definition.method !== "GET") throw new Error(`Synthetic mock refuses non-GET operation ${operationId}.`);
    return { operationId, ...routePattern(definition.route) };
  }).sort((left, right) => left.parameterCount - right.parameterCount
    || right.staticSegmentCount - left.staticSegmentCount);

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const match = operations.find((operation) => operation.pattern.test(url.pathname));
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    onRequest({ operationId: match.operationId, method: request.method, url });
    const example = examples.responses[match.operationId];
    response.writeHead(example.status, { "content-type": example.contentType });
    response.end(JSON.stringify(example.body));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
