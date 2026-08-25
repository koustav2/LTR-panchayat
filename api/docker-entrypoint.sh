#!/bin/sh
#
# The uploads directory is a bind mount from the host, so at runtime its
# ownership comes from the host — normally root:root — and replaces whatever
# the image set at build time. The unprivileged `node` user the API runs as
# then cannot write to it, and every upload fails with EACCES.
#
# So: start as root, fix ownership of the upload directory only, then drop
# privileges and exec the real command as `node`. The API itself never runs
# with root.
set -e

DIR="${UPLOAD_DIR:-/data/uploads}"

mkdir -p "$DIR"
# A read-only mount or an unusual host setup should not stop the app booting;
# the API surfaces a clear error on write instead.
chown -R node:node "$DIR" 2>/dev/null || echo "[entrypoint] could not chown $DIR — uploads may fail"

exec su-exec node "$@"
