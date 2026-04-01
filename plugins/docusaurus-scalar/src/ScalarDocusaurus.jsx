import BrowserOnly from "@docusaurus/BrowserOnly";
import Layout from "@theme/Layout";
import React from "react";

import "./theme.css";

const ScalarDocusaurus = ({ route }) => (
  <Layout>
    <BrowserOnly>
      {() => {
        const { ApiReferenceReact } = require("@scalar/api-reference-react");
        return <ApiReferenceReact configuration={route.configuration} />;
      }}
    </BrowserOnly>
  </Layout>
);

export default ScalarDocusaurus;
