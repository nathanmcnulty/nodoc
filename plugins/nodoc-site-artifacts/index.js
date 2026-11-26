/**
 * Publishes machine-readable site artifacts after the static build:
 * per-specification OpenAPI JSON downloads, a catalog, the operation index,
 * and llms.txt. The specification tooling is ESM, so it is imported lazily.
 */
const fsp = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");
const logger = require("@docusaurus/logger").default;

module.exports = function nodocSiteArtifacts(context) {
  return {
    name: "nodoc-site-artifacts",
    async postBuild({ outDir, siteConfig }) {
      const tools = await import(
        pathToFileURL(path.join(context.siteDir, "tools", "site-artifacts.mjs")).href
      );
      const specifications = await tools.loadSiteSpecifications();
      const operationIndex = await tools.buildOperationIndex(specifications);
      tools.assertOperationIndexShape(operationIndex);
      const { files } = tools.buildSiteArtifacts({
        specifications,
        operationIndex,
        siteUrl: siteConfig.url,
        baseUrl: siteConfig.baseUrl,
      });
      for (const [relativePath, text] of files) {
        const target = path.join(outDir, ...relativePath.split("/"));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, text, "utf8");
      }
      logger.info`[nodoc] number=${files.size} machine-readable site artifacts written`;
    },
  };
};
