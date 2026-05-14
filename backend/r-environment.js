export const R_RUNTIME_BOOTSTRAP = `
# Use /home/user for E2B persistence
Sys.setenv(R_LIBS_USER="/home/user/R/library")
.libPaths(c("/home/user/R/library", .libPaths()))
options(repos = c(CRAN = "https://cloud.r-project.org"))
`;

const MARKER_FILE = '/home/user/.r_env_ready';
const REQUIRED_PACKAGES = [
  'Rcpp',
  'RcppEigen',
  'Matrix',
  'deldir',
  'polyclip',
  'spatstat.random',
  'spatstat.geom',
  'spatstat.data',
  'spatstat.univar',
  'spatstat.utils',
  'swdpwr',
  'CRTSize',
  'survey',
  'survival',
  'lme4',
];

const APT_INSTALL_COMMAND = `
sudo bash -lc '
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    build-essential gfortran cmake pkg-config git \
    libopenblas-dev liblapack-dev \
    libcurl4-openssl-dev libssl-dev libxml2-dev \
    libgit2-dev libfreetype6-dev libfontconfig1-dev \
    libpng-dev libjpeg-dev libtiff5-dev libharfbuzz-dev libfribidi-dev
  apt-get clean
'
`.trim();

export async function ensureREnvironment(sandbox, log = () => {}) {
  const status = await sandbox.commands.run(`[ -f ${MARKER_FILE} ] && echo ready || echo missing`);
  if (status.stdout.includes('ready')) {
    log({
      status: 'completed',
      message: 'R environment already prepared with required packages.',
    });
    return;
  }

  log({
    status: 'running',
    message: 'Installing system libraries required for CRAN packages (one-time setup)...',
  });

  await sandbox.commands.run(APT_INSTALL_COMMAND, {
    timeoutMs: 480_000,
  });

  for (const pkg of REQUIRED_PACKAGES) {
    log({
      status: 'running',
      message: `Ensuring R package ${pkg} is available...`,
    });

    const rScript = [
      `Sys.setenv(R_LIBS_USER="/home/user/R/library")`,
      `.libPaths(c("/home/user/R/library", .libPaths()))`,
      `options(repos=c(CRAN="https://cloud.r-project.org"))`,
      `dir.create("/home/user/R/library", showWarnings = FALSE, recursive = TRUE)`,
      `if (!require("${pkg}", character.only = TRUE, quietly = TRUE)) install.packages("${pkg}", dependencies = TRUE, lib = "/home/user/R/library")`,
    ].join('; ');

    const installCommand = `R -q -e "${rScript.replace(/"/g, '\\"')}"`;

    try {
      await sandbox.commands.run(installCommand, { timeoutMs: 480_000 });
    } catch (error) {
      if (error.result?.stderr) {
        log({ status: 'running', message: error.result.stderr });
      }
      throw error;
    }
  }

  await sandbox.commands.run(`echo "ready" > ${MARKER_FILE}`);

  log({
    status: 'completed',
    message: 'R environment ready with swdpwr, lme4, survey, CRTSize, and survival.',
  });
}
