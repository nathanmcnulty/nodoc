import clsx from "clsx";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import type { ReactElement } from "react";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className="home--container">
          <a href="https://www.postman.com/dolphinlabs">
            <div className="home--block">
              <i className="icon--postman home--block-icon"></i>
              <p>
                <h4> Published Postman collections </h4>
                Use auto-generated Postman collections for interacting with
                nodoc APIs.
              </p>
            </div>
          </a>
          <a href="https://github.com/dolphinsec/nodoc">
            <div className="home--block">
              <i className="icon--github home--block-icon"></i>
              <p>
                <h4>Open-source specifications</h4>
                Use published API specs to develop tooling for interacting with
                the APIs.
              </p>
            </div>
          </a>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} | ${siteConfig.tagline}`}
      description={`${siteConfig.title} | ${siteConfig.tagline}`}
    >
      <HomepageHeader />
    </Layout>
  );
}
