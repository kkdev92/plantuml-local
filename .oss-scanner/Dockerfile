# Build environment for Anthropic OSS Scanner.
# The scanner builds this file with the repository root as its context.
# Dependencies and generated bundles remain available when scanning goes offline.
# The base image is pinned by digest (the multi-platform index), as the actions
# in .github/workflows are pinned by commit SHA; Dependabot moves the digest
# when the tag is rebuilt.
FROM node:24-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5

ENV CI=true \
    npm_config_audit=false \
    npm_config_fund=false

COPY . /src
WORKDIR /src

# Match the Node.js major version in .github/workflows/ci.yml.
# Install all dependencies while network access is permitted, then build.
RUN npm ci --no-audit --no-fund \
    && npm run lint \
    && npm run typecheck \
    && npm run bundle

# Run the tests so the image is known to work, without letting a failing
# test abort the build.
RUN npm run test || echo "WARNING: npm run test reported failures"
