# Portable recipe; independent of the private hosted application's image.
FROM node:20-bookworm-slim AS node_runtime
FROM rocker/r-ver:4.4.1
RUN apt-get update && apt-get install -y --no-install-recommends python3 libseccomp2 build-essential gfortran ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY scripts/install-r-packages.R /tmp/install-r-packages.R
RUN Rscript --vanilla /tmp/install-r-packages.R && rm /tmp/install-r-packages.R
WORKDIR /app
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scientific /app/scientific
COPY scripts/run-scientific.mjs /app/scripts/run-scientific.mjs
COPY portable-harness /app/portable-harness
COPY examples/scientific-request.json /app/examples/scientific-request.json
RUN chmod 700 /app && install -d -m 0711 /tmp/power-agent-scientific
ENV NODE_ENV=production
ENTRYPOINT ["node", "/app/scripts/run-scientific.mjs"]
