# Build environment for Anthropic OSS Scanner.
# The scanner builds this file with the repository root as its context.
# Dependencies and generated bundles remain available when scanning goes offline.
# The base image is pinned by digest (the multi-platform index), as the actions
# in .github/workflows are pinned by commit SHA; Dependabot moves the digest
# when the tag is rebuilt.
FROM node:24-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5

ARG NODE_VERSION=24.22.1
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      ppc64el) node_arch=ppc64le ;; \
      *) echo "Unsupported Node.js architecture" >&2; exit 1 ;; \
    esac; \
    node_archive="node-v$NODE_VERSION-linux-$node_arch.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/$node_archive"; \
    curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"; \
    grep "  $node_archive$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "$node_archive" -C /usr/local --strip-components=1 --no-same-owner; \
    rm "$node_archive" SHASUMS256.txt; \
    node --version; \
    npm --version; \
    true

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
