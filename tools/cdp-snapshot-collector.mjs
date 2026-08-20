export async function collectCdpDomSnapshots({
  sessionEntries,
  isDomCapableTarget,
  evaluateSnapshot,
  schemaVersion,
}) {
  const eligible = Array.from(sessionEntries)
    .filter(([sessionId, targetInfo]) => isDomCapableTarget(sessionId, targetInfo));
  const snapshots = await Promise.all(eligible.map(async ([sessionId, targetInfo]) => {
    try {
      const snapshot = await evaluateSnapshot(sessionId, targetInfo);
      if (!snapshot) return null;
      return {
        schemaVersion,
        targetId: targetInfo?.targetId ?? null,
        parentFrameId: targetInfo?.parentFrameId ?? null,
        parentSessionId: targetInfo?.parentSessionId ?? null,
        sessionId: sessionId ?? "root",
        targetTitle: targetInfo?.targetTitle ?? null,
        targetType: targetInfo?.targetType ?? "page",
        targetUrl: targetInfo?.targetUrl ?? null,
        ...snapshot,
      };
    } catch (error) {
      return {
        schemaVersion,
        targetId: targetInfo?.targetId ?? null,
        parentFrameId: targetInfo?.parentFrameId ?? null,
        parentSessionId: targetInfo?.parentSessionId ?? null,
        error: error instanceof Error ? error.message : String(error),
        sessionId: sessionId ?? "root",
        targetTitle: targetInfo?.targetTitle ?? null,
        targetType: targetInfo?.targetType ?? "page",
        targetUrl: targetInfo?.targetUrl ?? null,
      };
    }
  }));
  return snapshots.filter(Boolean);
}
