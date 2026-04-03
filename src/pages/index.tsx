import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import type { ReactElement } from "react";

import {
  accessModels,
  apiCatalog,
  checkedInCollectionsTreeUrl,
  gitHubRepositoryUrl,
  launchStats,
  postmanWorkspaceUrl,
  safeUsePrinciples,
} from "../data/siteData";
import styles from "./index.module.css";

function HomepageHeader(): ReactElement {
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <p className={styles.eyebrow}>OpenAPI + Postman for internal portal APIs</p>
        <Heading as="h1" className={styles.heroTitle}>
          Documenting undocumented Microsoft portal APIs
        </Heading>
        <p className={styles.heroSubtitle}>
          Browse {apiCatalog.length} portal-backed specs covering Defender XDR, Intune,
          M365 Admin, M365 Apps, Purview, and Entra surfaces, with checked-in
          Postman collections and launch-focused guidance on auth, headers, and safe
          usage.
        </p>
        <div className={styles.heroActions}>
          <Link className="button button--primary button--lg" to="/getting-started">
            Getting Started
          </Link>
          <a
            className="button button--secondary button--lg"
            href={postmanWorkspaceUrl}
          >
            Postman Workspace
          </a>
          <a className="button button--secondary button--lg" href={gitHubRepositoryUrl}>
            GitHub Repo
          </a>
        </div>
        <div className={styles.callout}>
          <strong>Use with care.</strong> These APIs are undocumented, unsupported
          by Microsoft, and may change without notice. Validate with read-only
          requests first and use non-production tenants for any write testing.
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactElement {
  return (
    <Layout
      title="nodoc | undocumented Microsoft portal APIs"
      description="OpenAPI specs and checked-in Postman collections for undocumented Microsoft portal APIs across Defender XDR, Intune, M365 Admin, M365 Apps, Purview, and Entra surfaces."
    >
      <HomepageHeader />
      <main>
        <section className={styles.section}>
          <div className="container">
            <div className={styles.statGrid}>
              {launchStats.map((stat) => (
                <div key={stat.label} className={styles.statCard}>
                  <span className={styles.statValue}>{stat.value}</span>
                  <span className={styles.statLabel}>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Coverage</Heading>
              <p>
                Every published spec has a matching checked-in Postman collection
                and a live Scalar page in this site.
              </p>
            </div>
            <div className={styles.cardGrid}>
              {apiCatalog.map((api) => (
                <article key={api.title} className={styles.apiCard}>
                  <div className={styles.apiCardHeader}>
                    <div>
                      <span className={styles.apiFamily}>{api.family}</span>
                      <Heading as="h3" className={styles.apiTitle}>
                        {api.title}
                      </Heading>
                    </div>
                    <span className={styles.operationsBadge}>
                      {api.operations} ops
                    </span>
                  </div>
                  <p className={styles.apiSummary}>{api.summary}</p>
                  <dl className={styles.detailList}>
                    <div>
                      <dt>Auth</dt>
                      <dd>{api.authModel}</dd>
                    </div>
                    <div>
                      <dt>Base URL</dt>
                      <dd>
                        <code>{api.baseUrl}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Collection</dt>
                      <dd>
                        <code>{api.collectionPath}</code>
                      </dd>
                    </div>
                  </dl>
                  <ul className={styles.highlightList}>
                    {api.highlights.map((highlight) => (
                      <li key={highlight}>{highlight}</li>
                    ))}
                  </ul>
                  <div className={styles.cardActions}>
                    <Link className="button button--primary button--sm" to={api.slug}>
                      Browse spec
                    </Link>
                    <a className="button button--secondary button--sm" href={api.collectionDownloadUrl}>
                      Download collection
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionAlt}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Access models</Heading>
              <p>
                The main usability difference between portals is how you obtain
                and preserve auth context.
              </p>
            </div>
            <div className={styles.modelGrid}>
              {accessModels.map((model) => (
                <article key={model.title} className={styles.modelCard}>
                  <Heading as="h3" className={styles.modelTitle}>
                    {model.title}
                  </Heading>
                  <p>{model.description}</p>
                  <p className={styles.modelPortals}>
                    <strong>Portals:</strong> {model.portals.join(", ")}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Safe usage defaults</Heading>
              <p>
                If you are new to these APIs, start conservative and validate
                from the portal outward.
              </p>
            </div>
            <div className={styles.principlesGrid}>
              {safeUsePrinciples.map((principle) => (
                <div key={principle} className={styles.principleCard}>
                  {principle}
                </div>
              ))}
            </div>
            <div className={styles.resourceRow}>
              <Link className="button button--primary" to="/getting-started">
                Read launch guidance
              </Link>
              <a className="button button--secondary" href={checkedInCollectionsTreeUrl}>
                View checked-in collections
              </a>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
