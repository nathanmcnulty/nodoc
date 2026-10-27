import BrowserOnly from "@docusaurus/BrowserOnly";
import Layout from "@theme/Layout";
import React, { Suspense } from "react";

import "@scalar/api-reference-react/style.css";
import "./theme.css";

const LazyApiReference = React.lazy(() =>
  import("@scalar/api-reference-react").then(({ ApiReferenceReact }) => ({
    default: ApiReferenceReact,
  }))
);

const ScalarDocusaurus = ({ configuration }) => {
  const specification = configuration?.content;
  const description = typeof specification?.info?.description === "string"
    ? specification.info.description.replace(/\s+/gu, " ").trim()
    : undefined;

  return (
    <Layout
      title={specification?.info?.title}
      description={description}
    >
      <BrowserOnly fallback={<div className="scalar-api-reference" />}>
        {() => (
          <Suspense fallback={<div className="scalar-api-reference" />}>
            <LazyApiReference configuration={configuration} />
          </Suspense>
        )}
      </BrowserOnly>
    </Layout>
  );
};

export default ScalarDocusaurus;
