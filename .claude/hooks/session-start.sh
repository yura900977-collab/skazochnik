#!/bin/bash
# Installs MarkItDown (Microsoft file -> Markdown converter) for the session.
# Runs only in Claude Code on the web (remote) environments.
set -euo pipefail

# Skip locally; only set up the ephemeral remote container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Idempotent: skip if markitdown already importable.
if python3 -c "import markitdown" >/dev/null 2>&1; then
  exit 0
fi

# cffi/cryptography first: overrides a broken system cryptography (_cffi_backend).
pip3 install --user --quiet --upgrade cffi cryptography
pip3 install --user --quiet 'markitdown[all]'
