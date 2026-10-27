import BrowserOnly from "@docusaurus/BrowserOnly";
import ErrorBoundary from "@docusaurus/ErrorBoundary";
import Layout from "@theme/Layout";
import React, { Suspense, useMemo, useState } from "react";

import "@scalar/api-reference-react/style.css";
import "./theme.css";

const ScalarDocusaurus = ({ configuration }) => {
  const [attempt, setAttempt] = useState(0);
  const LazyApiReference = useMemo(() => React.lazy(async () => {
    const [{ ApiReferenceReact }, { default: loadedConfiguration }] = await Promise.all([
      import("@scalar/api-reference-react"),
      configuration.load(),
    ]);
    if (loadedConfiguration?.content === undefined) {
      throw new Error("API reference data is unavailable.");
    }
    return { default: () => <ApiReferenceReact configuration={loadedConfiguration} /> };
  }), [configuration, attempt]);

  return (
    <Layout
      title={configuration.title}
      description={configuration.description}
    >
      <ErrorBoundary fallback={({ tryAgain }) => (
        <div className="scalar-api-reference" role="alert">
          <p>Unable to display this API reference.</p>
          <button type="button" onClick={() => {
            setAttempt((value) => value + 1);
            tryAgain();
          }}>Try again</button>
          {" "}
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      )}>
        <BrowserOnly fallback={<div className="scalar-api-reference" />}>
          {() => (
            <Suspense fallback={<div className="scalar-api-reference" />}>
              <LazyApiReference />
            </Suspense>
          )}
        </BrowserOnly>
      </ErrorBoundary>
    </Layout>
  );
};

export default ScalarDocusaurus;
