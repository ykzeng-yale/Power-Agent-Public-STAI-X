# Portable container recipe

The root Dockerfile uses public `rocker/r-ver:4.4.1` and `node:20-bookworm-slim` images. R source dependencies are pinned to jsonlite 2.0.0, pwr 1.3-0 and pmsampsize 1.1.3 and verified at build time. The source install needs CRAN access during the build. Additional study packages must be explicitly pinned and installed at build time; restricted R workers cannot download packages. These public tags are versioned rather than immutable digest pins, so record the resolved image digest and `sessionInfo()` for an experiment.

```bash
docker build -t power-agent-scientific:2.1.3 .
docker run --rm --env ANTHROPIC_API_KEY --mount type=bind,src="$PWD/examples/scientific-request.json",dst=/request.json,readonly power-agent-scientific:2.1.3 --mode single --input /request.json > record.json
```

Set the API key in the calling environment first. It is never copied into the image. The model caller needs network access; each generated R process runs under its own unprivileged identity with a filtered environment, `no_new_privs`, a seccomp network/syscall filter, resource limits and a private workspace. The root launcher provisions the traversable shared parent0711 and each run directory0700. Do not override the entrypoint or run the image as a non-root identity without understanding that the production restriction wrapper intentionally requires a root launcher to drop worker privileges.

The default image does not run the legacy web frontend or require Supabase, Google Cloud or the private hosted application's base image. The Docker recipe is provided separately from the production worker smoke evidence; it must be built and smoke-tested on the intended platform before claiming that environment's validation. Docker is unavailable on the development Mac. The complete public recipe was built in Google Cloud Build, and the final image passed actual Linux R harness/reference tests in build `95253d79-2339-4ffa-8e80-82345e35bf6b` on October 1, 2026. The standalone CLI and its restricted worker components have separate automated and hosted Linux smoke evidence. Those controls are bounded protections, not comprehensive adversarial sandbox certification.

Runtime 2.1.3 retains the post-study pooled-t reference gate and accepts a single unambiguous JSON result from actual successful R stdout. The original frozen study cohorts used 2.0.0 or 2.0.1-cloud. The separately frozen 2.1.2 release regression uses its own immutable production-derived image and protocol; it is reported separately. These container contract tests do not measure model accuracy.

The validated image digest is `sha256:2e10ee0a0ad41adb9daec8659447beeaa552a15cd1a0f086357085d522f2e9f4`. The image is stored in the project registry; the public Dockerfile allows independent rebuilds without access to that private registry. No model API call is part of these container contract tests.

The subsequent 2.1.3 correction separates explicitly labeled preceding count diagnostics from the selected minimum and checks their arithmetic. Its known-case R replays and live verification are separate from the unchanged 2.1.2 whole-cohort scores.
