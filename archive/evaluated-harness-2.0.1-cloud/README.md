# Frozen Linux study runtime2.0.1-cloud

Exact evaluated five-file core and hashes for the hosted Linux cohort. Relative to2.0.0, only the Linux worker NOFILE limit128→512 and harness version metadata changed. Workflow/executor/CLI hashes are unchanged. It predates the post-study2.1.0 pooled-t gate; do not attribute the gate to these scientific results.

For reproduction, supply the pinned Anthropic API key in the process environment and use the archived CLI. On Linux provision /tmp/power-agent-scientific with mode0711 and the required root/Python/libseccomp environment first; use an explicitly compatible package/image profile and record its digest/sessionInfo. The current standalone Docker recipe is a separately provisioned environment, not the original production-base digest. No benchmark answers or credentials are included.
