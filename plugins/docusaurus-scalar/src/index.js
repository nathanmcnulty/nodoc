/**
 * Docusaurus Scalar plugin - local fork of @x-delfino/docusaurus-scalar
 * Uses fast-glob (CJS) instead of globby (ESM) for Node.js compatibility.
 */
const {
  load,
  dereference,
  validate,
  readFilesPlugin,
  fetchUrlsPlugin,
} = require("@scalar/openapi-parser");
const fg = require("fast-glob");
const _ = require("lodash");
const path = require("path");
const logger = require("@docusaurus/logger").default;
const fsp = require("fs/promises");

const DEFAULT_NAV_CONFIG = {
  labelFromSpec: true,
  categoryFromPath: true,
};

const DEFAULT_ROUTE_CONFIG = {
  route: "scalar",
  routeFromSpec: true,
  routeFromPath: false,
};

const DEFAULT_PATH_CONFIG = {
  path: "./specifications",
  include: ["**/*.{json,yml,yaml}"],
};

const DEFAULT_SCALAR_CONFIG = {
  nav: DEFAULT_NAV_CONFIG,
  route: DEFAULT_ROUTE_CONFIG,
  paths: [DEFAULT_PATH_CONFIG],
  configurations: [],
};

function splitPathSegments(value) {
  return (value || "").split(/[\\/]/).filter(Boolean);
}

async function loadSpecsFromPath(paths, baseConfig) {
  return (
    await Promise.all(
      paths.map(async (source) => {
        const stats = await fsp.stat(source.path);
        const merged = mergeConfig(source, baseConfig);
        const fileSpecs = await Promise.all(
          (stats.isDirectory()
            ? await fg.glob(source?.include || "*", {
                cwd: source.path,
                ignore: source.exclude,
              })
            : stats.isFile()
            ? [source.path]
            : []
          ).map(async (file) => await loadSpecFromFile(merged, file))
        );
        logger.info`[Scalar] number=${
          fileSpecs.length
        } specifications loaded from path=${`${source.path}/${source.include}`}`;
        return fileSpecs;
      })
    )
  ).flat();
}

function mergeConfig(source, base) {
  const { nav: sourceNav, route: sourceRoute, ...sourceConfig } = source;
  const { nav: baseNav, route: baseRoute, ...baseConfig } = base;
  const merge = (a, b) => {
    return Object.fromEntries(
      Object.keys({ ...a, ...b }).map((key) => {
        a = a || {};
        return [key, typeof a[key] !== "undefined" ? a[key] : b[key]];
      })
    );
  };
  return {
    ...merge(sourceConfig, baseConfig),
    nav: merge(sourceNav, baseNav),
    route: merge(sourceRoute, baseRoute),
  };
}

async function loadSpecContent(specPath) {
  const fileSystem = await load(specPath, {
    plugins: [readFilesPlugin(), fetchUrlsPlugin()],
  });
  return (await dereference(fileSystem)).schema;
}

async function loadSpecFromFile(source, file) {
  const { dir, name } = path.parse(file);
  const fileSegments = splitPathSegments(file);
  const dirSegments = splitPathSegments(dir);
  const config = {
    ...source,
    spec: {
      content: await loadSpecContent(`${source.path}/${file}`),
    },
    nav: {
      ...source.nav,
      label: source?.nav?.labelFromFilename ? name : undefined,
      category:
        source?.nav?.category || source?.nav?.categoryFromPath
          ? fileSegments[0]
          : undefined,
    },
    route: {
      ...source.route,
      route: path.posix.join(
        "/",
        ...[
          source?.route?.route || "",
          ...(source?.route?.routeFromPath
            ? [...dirSegments, name]
            : []),
        ]
      ),
    },
  };
  return await loadSpecFromContent(config);
}

async function loadSpecFromContent(config) {
  if (config.spec?.content) {
    const validated = await validate(config.spec.content);
    // Support x-nodoc-category extension field for dropdown nav grouping
    const specCategory =
      validated.specification?.info?.["x-nodoc-category"] || undefined;
    return {
      ...config,
      nav: config.nav
        ? {
            label: config.nav.labelFromSpec
              ? validated.specification?.info?.title
              : config.nav.label,
            category: specCategory || config.nav.category,
          }
        : undefined,
      route: {
        route: path.posix.join(
          "/",
          ...[
            config?.route?.route || "",
            config?.route?.routeFromSpec
              ? validated.specification?.info?.title || ""
              : "",
          ].flatMap((seg) => seg.split("/").map((s) => _.kebabCase(s)))
        ),
      },
    };
      } else {
        throw "Specification content has not been loaded";
      }
}

async function loadSpecsFromConfig(configs, baseConfig) {
  return await Promise.all(
    configs.map(async (config) => {
      const merged = {
        ...mergeConfig(config, baseConfig),
        spec: {
          content: config.spec?.content
            ? config.spec.content
            : config.spec?.url
            ? await loadSpecContent(config.spec.url)
            : undefined,
        },
      };
      return await loadSpecFromContent(merged);
    })
  );
}

async function loadSpecs(options) {
  var { paths, configurations, ...specConfig } = options;
  const { spec, ...baseConfig } = specConfig;
  var configs = [];
  if (paths === false) {
    logger.info`[Scalar] paths disabled`;
  } else {
    if (paths === true || paths === undefined) {
      logger.info`[Scalar] default path used`;
      paths = [DEFAULT_PATH_CONFIG];
    }
    if (paths.length > 0) {
      logger.info`[Scalar] number=${paths.length} paths configured`;
    }
    configs = configs.concat(await loadSpecsFromPath(paths, baseConfig));
  }
  const specs = [
    ...(specConfig.spec ? [specConfig] : []),
    ...(configurations || []),
  ];
  if (specs.length > 0) {
    logger.info`[Scalar] number=${specs.length} specification definitions configured`;
    configs = configs.concat(await loadSpecsFromConfig(specs, baseConfig));
  }
  logger.info`[Scalar] number=${configs.length} specifications loaded`;
  return configs;
}

async function addToNav(context, config) {
  if (config.nav) {
    if (config.nav.label && config.route?.route) {
      const specNav = {
        label: config.nav.label,
        to: config.route.route,
        position: "left",
      };
      const navBar = context.siteConfig.themeConfig.navbar;
      if (config.nav.category) {
        for (const navItem of navBar.items) {
          if (
            navItem.type === "dropdown" &&
            navItem.label === config.nav.category
          ) {
            navItem.items.push(specNav);
            return;
          }
        }
        navBar.items.push({
          type: "dropdown",
          label: config.nav.category,
          items: [specNav],
          position: "left",
        });
      } else {
        navBar.items.push(specNav);
      }
    } else {
      logger.warn`[Scalar] spec cannot be added to navigation`;
    }
  }
}

const ScalarDocusaurus = (context, userOptions) => {
  const options = mergeConfig(userOptions, DEFAULT_SCALAR_CONFIG);
  return {
    name: "@scalar/docusaurus",

    getPathsToWatch() {
      if (options.paths === false) {
        return [];
      } else if (options.paths === true || options.paths === undefined) {
        options.paths = [DEFAULT_PATH_CONFIG];
      }
      return options.paths.flatMap((pathEntry) => {
        if (pathEntry.include) {
          return pathEntry.include.map(
            (include) => `${pathEntry.path}/${include}`
          );
        } else {
          return [];
        }
      });
    },

    async loadContent() {
      return await loadSpecs(options);
    },

    async contentLoaded({ content, actions }) {
      const { addRoute } = actions;
      const baseUrl = context.baseUrl || "/";
      content.forEach((contentItem) => {
        if (contentItem.route?.route) {
          // Docusaurus expects route paths to include baseUrl
          const routePath = path.posix.join(baseUrl, contentItem.route.route);
          addRoute({
            path: routePath,
            component: path.resolve(__dirname, "./ScalarDocusaurus"),
            exact: true,
            configuration: contentItem,
          });
          if (contentItem.nav?.label) {
            addToNav(context, contentItem);
          }
        }
      });
    },
  };
};

module.exports = ScalarDocusaurus;
module.exports.default = ScalarDocusaurus;
