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
  gettingStartedGuides,
  gitHubRepositoryUrl,
  postmanWorkspaceUrl,
  quickStartSteps,
  safeUsePrinciples,
} from "../data/siteData";
import styles from "./getting-started.module.css";

export default function GettingStarted(): ReactElement {
  return (
    <Layout
      title="Getting Started | nodoc"
      description="Launch guidance for using nodoc specs safely, including portal auth models, required headers, checked-in Postman collections, and mutation precautions."
    >
      <header className={styles.pageHeader}>
        <div className="container">
          <p className={styles.eyebrow}>Getting Started</p>
          <Heading as="h1" className={styles.pageTitle}>
            Use the specs safely and with the right auth context
          </Heading>
          <p className={styles.pageIntro}>
            nodoc documents internal Microsoft portal APIs. The fastest way to get
            value is to match the right portal family, auth model, and required
            headers before you try to automate anything.
          </p>
          <div className={styles.headerActions}>
            <a className="button button--primary button--lg" href={postmanWorkspaceUrl}>
              Open Postman workspace
            </a>
            <a className="button button--secondary button--lg" href={checkedInCollectionsTreeUrl}>
              Browse checked-in collections
            </a>
            <a className="button button--secondary button--lg" href={gitHubRepositoryUrl}>
              View repository
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.section}>
          <div className="container">
            <div className={styles.notice}>
              <strong>Important:</strong> treat every POST, PUT, PATCH, and DELETE
              request as a real tenant write until you have confirmed otherwise.
              If you only need to understand request shapes, capture browser
              traffic and start with GET-only validation instead of replaying
              mutations.
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Quick start</Heading>
              <p>
                These four steps are the safest way to move from portal browsing
                to reliable API usage.
              </p>
            </div>
            <div className={styles.stepsGrid}>
              {quickStartSteps.map((step, index) => (
                <article key={step.title} className={styles.stepCard}>
                  <span className={styles.stepNumber}>0{index + 1}</span>
                  <Heading as="h3" className={styles.cardTitle}>
                    {step.title}
                  </Heading>
                  <p>
                    <InlineCodeText text={step.description} />
                  </p>
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
                The repo currently spans {accessModels.length} distinct ways of
                authenticating to portal-backed APIs.
              </p>
            </div>
            <div className={styles.modelGrid}>
              {accessModels.map((model) => (
                <article key={model.title} className={styles.modelCard}>
                  <Heading as="h3" className={styles.cardTitle}>
                    {model.title}
                  </Heading>
                  <p>
                    <InlineCodeText text={model.description} />
                  </p>
                  <p className={styles.cardMeta}>
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
              <Heading as="h2">Portal-family guidance</Heading>
              <p>
                The notes below separate spec-confirmed details from practical
                operating guidance for each family.
              </p>
            </div>
            <div className={styles.guideStack}>
              {gettingStartedGuides.map((guide) => (
                <article key={guide.title} className={styles.guideCard}>
                  <div className={styles.guideHeader}>
                    <div>
                      <Heading as="h3" className={styles.cardTitle}>
                        {guide.title}
                      </Heading>
                      <p className={styles.cardMeta}>
                        <strong>Portals:</strong> {guide.portals.join(", ")}
                      </p>
                    </div>
                    <div className={styles.authBadge}>
                      <InlineCodeText text={guide.authModel} />
                    </div>
                  </div>

                  <div className={styles.baseUrlRow}>
                    {guide.baseUrls.map((baseUrl) => (
                      <code key={baseUrl} className={styles.codePill}>
                        {baseUrl}
                      </code>
                    ))}
                  </div>

                  <div className={styles.guideGrid}>
                    <div className={styles.detailCard}>
                      <Heading as="h4" className={styles.subheading}>
                        Confirmed in the specs
                      </Heading>
                      <ul className={styles.list}>
                        {guide.confirmedDetails.map((detail) => (
                          <li key={detail}>
                            <InlineCodeText text={detail} />
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.detailCard}>
                      <Heading as="h4" className={styles.subheading}>
                        Practical guidance
                      </Heading>
                      <ul className={styles.list}>
                        {guide.practicalGuidance.map((detail) => (
                          <li key={detail}>
                            <InlineCodeText text={detail} />
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.detailCard}>
                      <Heading as="h4" className={styles.subheading}>
                        Mutation safety
                      </Heading>
                      <ul className={styles.list}>
                        {guide.mutationGuidance.map((detail) => (
                          <li key={detail}>
                            <InlineCodeText text={detail} />
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.detailCard}>
                      <Heading as="h4" className={styles.subheading}>
                        Common pitfalls
                      </Heading>
                      <ul className={styles.list}>
                        {guide.pitfalls.map((detail) => (
                          <li key={detail}>
                            <InlineCodeText text={detail} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionAlt}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Safe defaults</Heading>
              <p>
                These principles apply across every portal surface in the site.
              </p>
            </div>
            <div className={styles.principlesGrid}>
              {safeUsePrinciples.map((principle) => (
                <div key={principle} className={styles.principleCard}>
                  <InlineCodeText text={principle} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Artifacts and entry points</Heading>
              <p>
                Every published spec page in the site has a matching checked-in
                Postman collection in the repository.
              </p>
            </div>
            <div className={styles.apiGrid}>
              {apiCatalog.map((api) => (
                <article key={api.title} className={styles.apiCard}>
                  <div className={styles.apiCardHeader}>
                    <Heading as="h3" className={styles.cardTitle}>
                      {api.title}
                    </Heading>
                    <QualityMaturityBadge maturity={api.quality?.maturity} />
                  </div>
                  <p className={styles.cardMeta}>
                    {api.operations} modeled operations · <InlineCodeText text={api.authModel} />
                  </p>
                  <p>
                    <InlineCodeText text={api.summary} />
                  </p>
                  <p className={styles.qualitySummary}>
                    <InlineCodeText text={api.qualitySummary} />
                  </p>
                  <div className={styles.cardActions}>
                    <Link className="button button--primary button--sm" to={api.slug}>
                      Open API page
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
        </section>
      </main>
    </Layout>
  );
}
