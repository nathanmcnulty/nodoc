/**
 * Route helpers shared by the Scalar plugin and the site artifact tooling, so
 * generated links always point at the route the plugin actually registers.
 */
const _ = require("lodash");
const path = require("path");

function splitPathSegments(value) {
  return (value || "").split(/[\\/]/).filter(Boolean);
}

function getSpecificationRouteSegments(specification) {
  const preferredRoute = specification?.info?.["x-nodoc-route"];
  if (preferredRoute) {
    return splitPathSegments(preferredRoute);
  }

  return splitPathSegments(specification?.info?.title || "").map((segment) =>
    _.kebabCase(segment)
  );
}

function getSpecificationRoute(specification, baseRoute = "/") {
  return path.posix.join(
    "/",
    baseRoute || "",
    ...getSpecificationRouteSegments(specification)
  );
}

module.exports = {
  splitPathSegments,
  getSpecificationRouteSegments,
  getSpecificationRoute,
};
