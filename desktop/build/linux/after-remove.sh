#!/bin/bash
set -e
# Optional post-remove hook for .deb packages.
update-desktop-database >/dev/null 2>&1 || true
exit 0
