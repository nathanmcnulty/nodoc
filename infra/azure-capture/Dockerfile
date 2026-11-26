FROM node:24.22.1-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates git tini \
    && rm -rf /var/lib/apt/lists
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tools ./tools
COPY specifications ./specifications
COPY src/data ./src/data
COPY src/generated ./src/generated
COPY AGENT_DISCOVERY_RUNBOOK.md AGENT_DISCOVERY_PLAYBOOK.md PORTAL_DISCOVERY_AGENT_PROMPT.md REFRESH_STATUS.md ./
ARG SOURCE_REVISION
RUN printf '%s' "$SOURCE_REVISION" | grep -Eq '^[0-9a-f]{40}$' \
    && printf '%s\n' "$SOURCE_REVISION" > .capture-revision \
    && mkdir /work \
    && chown node:node /work \
    && chmod -R a-w /app
USER node
WORKDIR /work
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/tools/private-capture-job.mjs"]
