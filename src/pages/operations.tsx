import Link from "@docusaurus/Link";
import { useHistory, useLocation } from "@docusaurus/router";
import useBaseUrl, { useBaseUrlUtils } from "@docusaurus/useBaseUrl";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";

import styles from "./operations.module.css";

type IndexedSpec = {
  specId: string;
  title: string;
  category: string | null;
  route: string;
  version: string | null;
  openapiVersion: string | null;
  operationCount: number;
};

type IndexedOperation = {
  specId: string;
  method: string;
  path: string;
  operationId: string | null;
  summary: string | null;
  tags: string[];
  deprecated: boolean;
  schemaGap: boolean;
  exampleGap: boolean;
  anchor: string | null;
};

type OperationIndex = {
  specs: IndexedSpec[];
  operations: IndexedOperation[];
};

type Filters = {
  q: string;
  spec: string;
  method: string;
  gap: string;
  page: number;
};

const pageSize = 50;
const gapOptions = [
  { value: "", label: "Any documentation state" },
  { value: "schema", label: "Schema gap" },
  { value: "example", label: "Example gap" },
  { value: "any", label: "Schema or example gap" },
  { value: "none", label: "No authored gaps" },
];
const count = (value: number) => value.toLocaleString("en-US");

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    q: params.get("q") ?? "",
    spec: params.get("spec") ?? "",
    method: (params.get("method") ?? "").toUpperCase(),
    gap: params.get("gap") ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function writeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.spec) params.set("spec", filters.spec);
  if (filters.method) params.set("method", filters.method);
  if (filters.gap) params.set("gap", filters.gap);
  if (filters.page > 1) params.set("page", String(filters.page));
  const search = params.toString();
  return search ? `?${search}` : "";
}

function matchesGap(operation: IndexedOperation, gap: string): boolean {
  switch (gap) {
    case "schema":
      return operation.schemaGap;
    case "example":
      return operation.exampleGap;
    case "any":
      return operation.schemaGap || operation.exampleGap;
    case "none":
      return !operation.schemaGap && !operation.exampleGap;
    default:
      return true;
  }
}

function GapBadges({ operation }: { operation: IndexedOperation }): ReactElement {
  if (!operation.schemaGap && !operation.exampleGap) {
    return <span className={styles.muted}>None authored</span>;
  }
  return (
    <span className={styles.badges}>
      {operation.schemaGap ? <span className={styles.gapBadge}>Schema</span> : null}
      {operation.exampleGap ? <span className={styles.gapBadge}>Example</span> : null}
    </span>
  );
}

export default function Operations(): ReactElement {
  const location = useLocation();
  const history = useHistory();
  const [index, setIndex] = useState<OperationIndex | null>(null);
  const [loadError, setLoadError] = useState(false);
  const filters = useMemo(() => readFilters(location.search), [location.search]);
  const [query, setQuery] = useState(filters.q);
  const catalogUrl = useBaseUrl("/openapi/index.json");
  const operationsUrl = useBaseUrl("/operations.json");
  const llmsUrl = useBaseUrl("/llms.txt");
  const { withBaseUrl } = useBaseUrlUtils();

  useEffect(() => {
    let active = true;
    import("../generated/operationIndex.json")
      .then((module) => {
        if (active) setIndex((module.default ?? module) as unknown as OperationIndex);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setQuery(filters.q);
  }, [filters.q]);

  const update = (changes: Partial<Filters>) => {
    const next = { ...filters, page: 1, ...changes };
    history.replace({ pathname: location.pathname, search: writeFilters(next) });
  };

  const specsById = useMemo(
    () => new Map((index?.specs ?? []).map((spec) => [spec.specId, spec])),
    [index],
  );
  const searchable = useMemo(
    () =>
      (index?.operations ?? []).map((operation) => ({
        operation,
        haystack: [
          operation.method,
          operation.path,
          operation.summary,
          operation.operationId,
          specsById.get(operation.specId)?.title,
          ...operation.tags,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [index, specsById],
  );
  const methods = useMemo(
    () => [...new Set((index?.operations ?? []).map((operation) => operation.method))].sort(),
    [index],
  );

  const results = useMemo(() => {
    const terms = filters.q.toLowerCase().split(/\s+/u).filter(Boolean);
    return searchable
      .filter(
        ({ operation, haystack }) =>
          (!filters.spec || operation.specId === filters.spec)
          && (!filters.method || operation.method === filters.method)
          && matchesGap(operation, filters.gap)
          && terms.every((term) => haystack.includes(term)),
      )
      .map(({ operation }) => operation);
  }, [searchable, filters]);

  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(filters.page, pageCount);
  const visible = results.slice((page - 1) * pageSize, page * pageSize);
  const firstShown = results.length ? (page - 1) * pageSize + 1 : 0;

  const submitQuery = (event: FormEvent) => {
    event.preventDefault();
    update({ q: query });
  };

  return (
    <Layout
      title="Operation index"
      description="Search every operation documented in nodoc's OpenAPI specifications for undocumented Microsoft portal APIs, with deep links and machine-readable downloads."
    >
      <header className={styles.pageHeader}>
        <div className="container">
          <p className={styles.eyebrow}>Operation index</p>
          <Heading as="h1" className={styles.pageTitle}>
            Find any documented operation
          </Heading>
          <p className={styles.pageIntro}>
            Search by path, summary, operation ID, tag, or portal. Each result opens its section in the API
            reference. Gap flags describe the checked-in documents only; they are not observations of portal
            behavior. See <Link to="/coverage">coverage</Link> for reviewed observation snapshots.
          </p>
          <ul className={styles.downloads} aria-label="Machine-readable downloads">
            <li>
              <a href={catalogUrl}>OpenAPI catalog</a>
              <span className={styles.muted}> JSON downloads, sizes, and SHA-256 digests</span>
            </li>
            <li>
              <a href={operationsUrl}>operations.json</a>
              <span className={styles.muted}> this index with absolute deep links</span>
            </li>
            <li>
              <a href={llmsUrl}>llms.txt</a>
              <span className={styles.muted}> a short guide for language models</span>
            </li>
          </ul>
        </div>
      </header>

      <main className={styles.section}>
        <div className="container">
          <form className={styles.filters} onSubmit={submitQuery} role="search">
            <label className={styles.searchField}>
              <span>Search</span>
              <input
                type="search"
                value={query}
                placeholder="e.g. alerts GET, roleAssignments, autopatch"
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => query !== filters.q && update({ q: query })}
              />
            </label>
            <label>
              <span>Specification</span>
              <select value={filters.spec} onChange={(event) => update({ spec: event.target.value })}>
                <option value="">All specifications</option>
                {(index?.specs ?? []).map((spec) => (
                  <option key={spec.specId} value={spec.specId}>
                    {spec.title} ({count(spec.operationCount)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Method</span>
              <select value={filters.method} onChange={(event) => update({ method: event.target.value })}>
                <option value="">Any method</option>
                {methods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Documentation</span>
              <select value={filters.gap} onChange={(event) => update({ gap: event.target.value })}>
                {gapOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button button--primary">
              Search
            </button>
          </form>

          {loadError ? (
            <p className={styles.status} role="alert">
              The operation index could not be loaded. Download <a href={operationsUrl}>operations.json</a> instead.
            </p>
          ) : !index ? (
            <p className={styles.status} aria-live="polite">
              Loading the operation index…
            </p>
          ) : (
            <>
              <p className={styles.status} aria-live="polite">
                {results.length
                  ? `Showing ${count(firstShown)}–${count(firstShown + visible.length - 1)} of ${count(results.length)} operations`
                  : "No operations match these filters."}
                {results.length !== index.operations.length
                  ? ` (filtered from ${count(index.operations.length)})`
                  : ` across ${count(index.specs.length)} specifications`}
              </p>
              {visible.length ? (
                <div className={styles.tableWrapper}>
                  <table className={styles.operationsTable}>
                    <thead>
                      <tr>
                        <th scope="col">Operation</th>
                        <th scope="col">Specification</th>
                        <th scope="col">Tags</th>
                        <th scope="col">Authored gaps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((operation) => {
                        const spec = specsById.get(operation.specId);
                        const route = withBaseUrl(spec?.route ?? "/");
                        const href = spec && operation.anchor ? `${route}#${operation.anchor}` : route;
                        return (
                          <tr key={`${operation.specId} ${operation.method} ${operation.path}`}>
                            <td>
                              <a className={styles.operationLink} href={href}>
                                <span className={styles.method} data-method={operation.method}>
                                  {operation.method}
                                </span>
                                <code className={styles.path}>{operation.path}</code>
                              </a>
                              {operation.summary ? <span className={styles.summary}>{operation.summary}</span> : null}
                              {operation.deprecated ? <span className={styles.deprecated}>Deprecated</span> : null}
                              {!operation.anchor ? (
                                <span className={styles.muted}> Opens the specification page; this path has no stable section link.</span>
                              ) : null}
                            </td>
                            <td>{spec?.title ?? operation.specId}</td>
                            <td className={styles.tags}>{operation.tags.join(", ") || <span className={styles.muted}>Untagged</span>}</td>
                            <td>
                              <GapBadges operation={operation} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {pageCount > 1 ? (
                <nav className={styles.pagination} aria-label="Result pages">
                  <button
                    type="button"
                    className="button button--secondary button--sm"
                    disabled={page <= 1}
                    onClick={() => update({ page: page - 1 })}
                  >
                    Previous
                  </button>
                  <span>
                    Page {count(page)} of {count(pageCount)}
                  </span>
                  <button
                    type="button"
                    className="button button--secondary button--sm"
                    disabled={page >= pageCount}
                    onClick={() => update({ page: page + 1 })}
                  >
                    Next
                  </button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </main>
    </Layout>
  );
}
