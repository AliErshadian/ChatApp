#!/bin/bash
set -e
# Optional post-install hook for .deb packages.
update-desktop-database >/dev/null 2>&1 || true
exit 0
