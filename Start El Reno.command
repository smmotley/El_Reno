#!/bin/bash
cd "$(dirname "$0")" || exit 1
el_reno_node="$(command -v node)"
if [ -z "$el_reno_node" ] && [ -x /opt/homebrew/bin/node ]; then el_reno_node=/opt/homebrew/bin/node; fi
if [ -z "$el_reno_node" ]; then
  printf 'Node.js is needed to start El Reno. Install it from https://nodejs.org and try again.\n'
  read -r
  exit 1
fi
"$el_reno_node" scripts/serve.mjs --open
