import BrowserOnly from "@docusaurus/BrowserOnly";
import Layout from "@theme/Layout";
import React, { Suspense, useMemo } from "react";

import "@scalar/api-reference-react/style.css";
import "./theme.css";

const ScalarDocusaurus = ({ configuration }) => {
  const LazyApiReference = useMemo(() => React.lazy(async () => {
    const [{ ApiReferenceReact }, { default: loadedConfiguration }] = await Promise.all([
      import("@scalar/api-reference-react"),
      configuration.load(),
    ]);
    return { default: () => <ApiReferenceReact configuration={loadedConfiguration} /> };
  }), [configuration]);

  return (
    <Layout
      title={configuration.title}
      description={configuration.description}
    >
      <BrowserOnly fallback={<div className="scalar-api-reference" />}>
        {() => (
          <Suspense fallback={<div className="scalar-api-reference" />}>
            <LazyApiReference />
          </Suspense>
        )}
      </BrowserOnly>
    </Layout>
  );
};

export default ScalarDocusaurus;
