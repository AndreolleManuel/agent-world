#!/bin/sh
# Legacy entry point intentionally refuses deployment with general SSH rights.
printf '%s\n' 'Agent World protocol 2 requires the separate administrative installer.' 'Read docs/VPS.md and use scripts/install-secure-vps.py from reviewed sources.' >&2
exit 1
