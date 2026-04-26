import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import type { ReactElement } from "react";

import InlineCodeText from "../InlineCodeText";
import QualityMaturityBadge from "../QualityMaturityBadge";
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

const apiCatalogByFamily = Array.from(
  apiCatalog.reduce((families, api) => {
    const familyEntries = families.get(api.family);

    if (familyEntries) {
      familyEntries.push(api);
    } else {
      families.set(api.family, [api]);
    }

    return families;
  }, new Map<string, typeof apiCatalog>()),
);

function HomepageHeader(): ReactElement {
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <p className={styles.eyebrow}>OpenAPI + Postman for internal portal APIs</p>
        <Heading as="h1" className={styles.heroTitle}>
          Documenting undocumented Microsoft portal APIs
        </Heading>
        <p className={styles.heroSubtitle}>
          Browse {apiCatalog.length} portal-backed specs covering Defender XDR, Exchange,
          Teams, Intune, M365 Admin, SharePoint, M365 Apps, Power Platform, Purview, Purview Portal,
          Viva, and Entra surfaces, with
          checked-in Postman collections and launch-focused guidance on auth,
          headers, and safe usage.
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
      description="OpenAPI specs and checked-in Postman collections for undocumented Microsoft portal APIs across Defender XDR, Exchange, Teams, Intune, M365 Admin, SharePoint, M365 Apps, Power Platform, Purview, Purview Portal, and Entra surfaces."
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
                and is grouped below by portal family.
              </p>
            </div>
            {apiCatalogByFamily.map(([family, familyApis]) => (
              <div key={family} className={styles.familyGroup}>
                <div className={styles.familyHeader}>
                  <Heading as="h3" className={styles.familyTitle}>
                    {family}
                  </Heading>
                  <p>
                    {familyApis.length} published {familyApis.length === 1 ? "API" : "APIs"}
                  </p>
                </div>
                <div className={styles.cardGrid}>
                  {familyApis.map((api) => (
                    <article key={api.title} className={styles.apiCard}>
                      <div className={styles.apiCardHeader}>
                        <Heading as="h4" className={styles.apiTitle}>
                          {api.title}
                        </Heading>
                        <div className={styles.apiBadges}>
                          <span className={styles.operationsBadge}>
                            {api.operations} ops
                          </span>
                          <QualityMaturityBadge maturity={api.quality?.maturity} />
                        </div>
                      </div>
                      <p className={styles.apiSummary}>
                        <InlineCodeText text={api.summary} />
                      </p>
                      <p className={styles.qualitySummary}>
                        <strong>Quality:</strong>{" "}
                        <InlineCodeText text={api.qualitySummary} />
                      </p>
                      <dl className={styles.detailList}>
                        <div>
                          <dt>Auth</dt>
                          <dd>
                            <InlineCodeText text={api.authModel} />
                          </dd>
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
                        <div>
                          <dt>OpenAPI</dt>
                          <dd>
                            <code>{api.specPath}</code>
                          </dd>
                        </div>
                      </dl>
                      <ul className={styles.highlightList}>
                        {api.highlights.map((highlight) => (
                          <li key={highlight}>
                            <InlineCodeText text={highlight} />
                          </li>
                        ))}
                      </ul>
                      <div className={styles.cardActions}>
                        <Link className="button button--primary button--sm" to={api.slug}>
                          Browse spec
                        </Link>
                        <a className="button button--secondary button--sm" href={api.specSourceUrl}>
                          OpenAPI source
                        </a>
                        <a className="button button--secondary button--sm" href={api.collectionDownloadUrl}>
                          Download collection
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
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
                  <p>
                    <InlineCodeText text={model.description} />
                  </p>
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
                  <InlineCodeText text={principle} />
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
