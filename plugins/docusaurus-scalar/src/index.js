/**
 * Docusaurus Scalar plugin - local fork of @x-delfino/docusaurus-scalar
 * Uses fast-glob (CJS) and dynamic imports for the ESM Scalar packages.
 */
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

let scalarParserModulesPromise;

async function getScalarParserModules() {
  if (!scalarParserModulesPromise) {
    scalarParserModulesPromise = Promise.all([
      import("@scalar/openapi-parser"),
      import("@scalar/openapi-parser/plugins/read-files"),
      import("@scalar/openapi-parser/plugins/fetch-urls"),
    ]).then(([parser, readFiles, fetchUrls]) => ({
      load: parser.load,
      validate: parser.validate,
      readFilesPlugin: readFiles.readFiles,
      fetchUrlsPlugin: fetchUrls.fetchUrls,
    }));
  }

  return scalarParserModulesPromise;
}

function splitPathSegments(value) {
  return (value || "").split(/[\\/]/).filter(Boolean);
}

function cloneObject(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function decodePointerToken(token) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function getByPointer(root, pointer) {
  if (!pointer || pointer === "#") {
    return root;
  }

  const normalized = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (!normalized) {
    return root;
  }

  return normalized.split("/").slice(1).reduce((current, part) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    return current[decodePointerToken(part)];
  }, root);
}

function splitReference(value) {
  const [filePart, fragmentPart] = value.split("#");
  return {
    filePart: filePart || "",
    fragment: fragmentPart ? `#${fragmentPart}` : "#",
  };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || "");
}

function resolveReferenceFile(currentFile, refFile) {
  if (!refFile) {
    return currentFile;
  }

  if (isHttpUrl(refFile)) {
    return refFile;
  }

  if (isHttpUrl(currentFile)) {
    return new URL(refFile, currentFile).toString();
  }

  const currentDir =
    currentFile && currentFile.includes("/")
      ? currentFile.slice(0, currentFile.lastIndexOf("/"))
      : ".";

  return path.posix.normalize(path.posix.join(currentDir, refFile));
}

function createSpecificationMap(fileSystem) {
  return new Map(
    fileSystem.filesystem
      .filter((entry) => entry.isEntrypoint || entry.filename)
      .map((entry) => [entry.filename || ".", entry.specification])
  );
}

function bundleSpecification(fileSystem) {
  const entry =
    fileSystem.filesystem.find((item) => item.isEntrypoint) || fileSystem;
  const specificationMap = createSpecificationMap(fileSystem);
  const cache = new Map();

  function expandNode(node, currentFile, stack = []) {
    if (Array.isArray(node)) {
      return node.map((item) => expandNode(item, currentFile, stack));
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    if (typeof node.$ref === "string") {
      const { filePart, fragment } = splitReference(node.$ref);
      const targetFile = resolveReferenceFile(currentFile, filePart);
      const cacheKey = `${targetFile}|${fragment}`;

      if (stack.includes(cacheKey)) {
        return cloneObject(node);
      }

      if (cache.has(cacheKey)) {
        const siblings = Object.fromEntries(
          Object.entries(node).filter(([key]) => key !== "$ref")
        );
        return Object.keys(siblings).length > 0
          ? {
              ...cloneObject(cache.get(cacheKey)),
              ...expandNode(siblings, currentFile, stack),
            }
          : cloneObject(cache.get(cacheKey));
      }

      const root = specificationMap.get(targetFile);
      if (!root) {
        throw new Error(
          `Unable to resolve external reference "${node.$ref}" from "${currentFile}"`
        );
      }

      const target = getByPointer(root, fragment);
      if (typeof target === "undefined") {
        throw new Error(
          `Unable to resolve pointer "${fragment}" in "${targetFile}"`
        );
      }

      const expanded = expandNode(target, targetFile, [...stack, cacheKey]);
      cache.set(cacheKey, cloneObject(expanded));

      const siblings = Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== "$ref")
      );
      return Object.keys(siblings).length > 0
        ? { ...cloneObject(expanded), ...expandNode(siblings, currentFile, stack) }
        : cloneObject(expanded);
    }

    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        expandNode(value, currentFile, stack),
      ])
    );
  }

  return expandNode(entry.specification, ".");
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
  const { load, readFilesPlugin, fetchUrlsPlugin } = await getScalarParserModules();
  const fileSystem = await load(specPath, {
    plugins: [readFilesPlugin(), fetchUrlsPlugin()],
  });
  return bundleSpecification(fileSystem);
}

async function loadSpecFromFile(source, file) {
  const { dir, name } = path.parse(file);
  const fileSegments = splitPathSegments(file);
  const dirSegments = splitPathSegments(dir);
  const config = {
    ...source,
    content: await loadSpecContent(path.join(source.path, file)),
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

function buildScalarConfiguration(config) {
  const {
    nav,
    route,
    paths,
    configurations,
    include,
    exclude,
    path: configPath,
    url,
    spec,
    scalarConfiguration,
    ...scalarConfig
  } = config;

  return {
    ...scalarConfig,
    _integration: "docusaurus",
  };
}

async function loadSpecFromContent(config) {
  if (config.content) {
    const { validate } = await getScalarParserModules();
    const validated = await validate(config.content);
    // Support x-nodoc-category extension field for dropdown nav grouping
    const specCategory =
      validated.specification?.info?.["x-nodoc-category"] || undefined;
    return {
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
      scalarConfiguration: {
        ...buildScalarConfiguration(config),
        content: validated.specification || config.content,
      },
    };
  } else {
    throw new Error("Specification content has not been loaded");
  }
}

async function loadSpecsFromConfig(configs, baseConfig) {
  return await Promise.all(
    configs.map(async (config) => {
      const mergedConfig = mergeConfig(config, baseConfig);
      const { spec, ...mergedBase } = mergedConfig;
      const merged = {
        ...mergedBase,
        content:
          mergedConfig.content ||
          spec?.content ||
          (spec?.url
            ? await loadSpecContent(spec.url)
            : mergedConfig.url
            ? await loadSpecContent(mergedConfig.url)
            : undefined),
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
    ...(specConfig.spec || specConfig.content || specConfig.url ? [specConfig] : []),
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
            configuration: contentItem.scalarConfiguration,
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
