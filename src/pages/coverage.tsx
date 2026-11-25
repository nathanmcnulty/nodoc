import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import type { ReactElement } from "react";

import { apiCatalog, gitHubRepositoryUrl } from "../data/siteData";
import { publicCoverage } from "../generated/publicCoverage";
import styles from "./coverage.module.css";

type SnapshotRow = {
  operations: number;
  currentObservations: number;
  staleObservations: number;
  notObserved: number;
  latestErrorObserved: number;
  completeBodyObserved: number | null;
  schemaGaps: number;
  exampleGaps: number;
};

const latest = publicCoverage.snapshots[0];
const slugByTitle = new Map(apiCatalog.map((api) => [api.title, api.slug]));
const count = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${((part / whole) * 100).toFixed(1)}%`;
const assessedDate = new Date(latest.assessedAt).toLocaleDateString("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const snapshotUrl = `${gitHubRepositoryUrl}/blob/main/src/data/coverageSnapshots/${latest.snapshotId}.json`;
const reportUrl = `${gitHubRepositoryUrl}/blob/main/${latest.source.report}`;
const workflowUrl = `${gitHubRepositoryUrl}/blob/main/REFRESH_WORKFLOW.md`;

function GapCell({ snapshot, current }: { snapshot: number | undefined; current: number }): ReactElement {
  if (snapshot === undefined || snapshot === current) {
    return <td className={styles.numeric}>{count(current)}</td>;
  }
  const change = current - snapshot;

  return (
    <td className={styles.numeric}>
      {count(current)}{" "}
      <span className={change < 0 ? styles.improved : styles.regressed}>
        ({change > 0 ? "+" : ""}
        {count(change)} since snapshot)
      </span>
    </td>
  );
}

function ObservedCell({ row }: { row: SnapshotRow }): ReactElement {
  const observed = row.currentObservations;
  const share = row.operations === 0 ? 0 : (observed / row.operations) * 100;

  return (
    <td className={styles.numeric}>
      <span className={styles.observedValue}>
        {count(observed)} <span className={styles.muted}>({percent(observed, row.operations)})</span>
      </span>
      {row.staleObservations > 0 ? (
        <span className={styles.muted}>+{count(row.staleObservations)} before window</span>
      ) : null}
      <span className={styles.meter} aria-hidden="true">
        <span style={{ width: `${share}%` }} />
      </span>
    </td>
  );
}

export default function Coverage(): ReactElement {
  const totals = latest.totals;
  const current = publicCoverage.currentSource;
  const cards = [
    { value: count(totals.operations), label: `Operations modeled at the ${assessedDate} assessment` },
    {
      value: count(totals.currentObservations),
      label: `Observed in the ${latest.windowDays}-day window (${percent(totals.currentObservations, totals.operations)})`,
    },
    { value: count(totals.latestErrorObserved), label: "Latest observation was an error" },
    { value: count(totals.completeBodyObserved), label: "Complete response body verified" },
    { value: count(current.schemaGaps), label: "Authored schema gaps in current source" },
    { value: count(current.exampleGaps), label: "Authored example gaps in current source" },
  ];

  return (
    <Layout
      title="Coverage | nodoc"
      description="Dated observation coverage for nodoc's Microsoft portal API specifications, reported separately from authored schema and example gaps."
    >
      <header className={styles.pageHeader}>
        <div className="container">
          <p className={styles.eyebrow}>Coverage</p>
          <Heading as="h1" className={styles.pageTitle}>
            What was observed, not just what is documented
          </Heading>
          <p className={styles.pageIntro}>
            A specification can describe an operation that nobody has seen recently, and an
            observed operation can still lack a usable schema. This page reports those
            measures separately so you can judge how much to trust each contract.
          </p>
        </div>
      </header>

      <main>
        <section className={styles.section}>
          <div className="container">
            <div className={styles.statGrid}>
              {cards.map((card) => (
                <div key={card.label} className={styles.statCard}>
                  <span className={styles.statValue}>{card.value}</span>
                  <span className={styles.statLabel}>{card.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionAlt}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">How to read this</Heading>
            </div>
            <dl className={styles.definitions}>
              <div>
                <dt>Observed</dt>
                <dd>
                  An exact, attributed request from a complete capture within the {latest.windowDays} days
                  before the assessment. Observation counts change only when a reviewed refresh is
                  published; rebuilding this site never renews them.
                </dd>
              </div>
              <div>
                <dt>Not observed</dt>
                <dd>
                  No qualifying capture at all. It does not mean the endpoint was removed, and
                  neither does an HTTP 404. Operations last seen before the window are noted
                  separately in the Observed column.
                </dd>
              </div>
              <div>
                <dt>Latest error</dt>
                <dd>
                  The most recent qualifying observation returned an error. Access, licensing or
                  tenant state can cause this; it is not proof of a broken contract.
                </dd>
              </div>
              <div>
                <dt>Schema and example gaps</dt>
                <dd>
                  Authored-model diagnostics computed from the specification source: a response
                  without a concrete schema or without an example. Current values are recalculated
                  from today&apos;s source; changes since the snapshot are shown in parentheses.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">By specification</Heading>
              <p>
                Observation columns come from the {assessedDate} snapshot. Gap columns use current
                source. Operation counts can differ when a specification changed after the snapshot.
              </p>
            </div>
            <div className={styles.tableWrapper}>
              <table className={styles.coverageTable}>
                <caption className={styles.caption}>
                  Coverage by specification, assessed {assessedDate}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Specification</th>
                    <th scope="col" className={styles.numeric}>Operations</th>
                    <th scope="col" className={styles.numeric}>Observed</th>
                    <th scope="col" className={styles.numeric}>Not observed</th>
                    <th scope="col" className={styles.numeric}>Latest error</th>
                    <th scope="col" className={styles.numeric}>Schema gaps</th>
                    <th scope="col" className={styles.numeric}>Example gaps</th>
                  </tr>
                </thead>
                <tbody>
                  {publicCoverage.specs.map((spec) => {
                    const row = spec.latest as SnapshotRow | null;
                    const slug = slugByTitle.get(spec.title);

                    return (
                      <tr key={spec.specId}>
                        <th scope="row">
                          {slug ? <Link to={slug}>{spec.title}</Link> : spec.title}
                        </th>
                        <td className={styles.numeric}>
                          {count(spec.current.operations)}
                          {row && row.operations !== spec.current.operations ? (
                            <span className={styles.muted}> ({count(row.operations)} at snapshot)</span>
                          ) : null}
                        </td>
                        {row ? (
                          <>
                            <ObservedCell row={row} />
                            <td className={styles.numeric}>{count(row.notObserved)}</td>
                            <td className={styles.numeric}>{count(row.latestErrorObserved)}</td>
                          </>
                        ) : (
                          <td colSpan={3} className={styles.notAssessed}>
                            Not assessed in this snapshot
                          </td>
                        )}
                        <GapCell snapshot={row?.schemaGaps} current={spec.current.schemaGaps} />
                        <GapCell snapshot={row?.exampleGaps} current={spec.current.exampleGaps} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.sourceNote}>
              Source: the reviewed <a href={reportUrl}>refresh report</a> starting from commit{" "}
              <code>{latest.source.baseRevision}</code>. Download the{" "}
              <a href={snapshotUrl}>public snapshot JSON</a> or read the{" "}
              <a href={workflowUrl}>refresh workflow</a> for how captures are reviewed. Snapshots
              contain only aggregate counts; raw captures and tenant data stay private.
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}
