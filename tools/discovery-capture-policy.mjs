export const responseBodyCaptureLimit = 512 * 1024;

export function decodeBoundedCdpBody(payload, limit = responseBodyCaptureLimit) {
  const value = payload?.body ?? payload?.content;
  if (typeof value !== "string") {
    return null;
  }

  const encoding = payload?.base64Encoded ? "base64" : "utf8";
  if (Buffer.byteLength(value, encoding) > limit) {
    return null;
  }

  return payload?.base64Encoded
    ? Buffer.from(value, "base64").toString("utf8")
    : value;
}

export function shouldRequestResponseBody(encodedDataLength, limit = responseBodyCaptureLimit) {
  const length = Number(encodedDataLength);
  return Number.isFinite(length) && length >= 0 && length <= limit;
}

export function actionResultSucceeded(actionResult) {
  const { result = {}, type } = actionResult;
  if (type === "navigate") {
    try {
      const actual = new URL(result.url);
      const expected = new URL(result.resolvedUrl ?? actionResult.value);
      return actual.origin === expected.origin
        && (actionResult.allowCanonicalRedirect || actual.pathname === expected.pathname);
    } catch {
      return false;
    }
  }
  if (type.startsWith("click")) {
    return result.clicked === true && (
      result.beforeUrl !== result.afterUrl
      || result.stateTransition === true
      || result.targetTransition === true
    );
  }
  if (type === "probe-get") {
    return result.outcome === "confirmed";
  }
  if (type === "replay-seeded-links" || type === "replay-seeded-routes") {
    return Number(result.replayedCount) > 0;
  }
  return true;
}

export function summarizeActionResults(actionResults) {
  const requiredFailures = actionResults
    .filter((actionResult) => actionResult.required && !actionResultSucceeded(actionResult))
    .map(({ page, type, value }) => ({ page, type, value }));
  return {
    requiredActionCount: actionResults.filter((actionResult) => actionResult.required).length,
    requiredActionFailureCount: requiredFailures.length,
    requiredActionFailures: requiredFailures,
  };
}
