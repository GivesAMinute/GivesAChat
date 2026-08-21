#!/usr/bin/env bash
#
# commit.sh — commit everything, clearing any stale git locks first.
#
#   ./commit.sh "your message"
#   ./commit.sh                  (uses a default message)
#
# WHY THIS EXISTS
#
# The project folder is shared into Claude's sandbox over a FUSE mount
# that allows creating files but denies unlinking them. Git takes a
# lock (.git/index.lock, .git/HEAD.lock) for every write, and when it
# tries to clean up afterwards the filesystem refuses:
#
#   warning: unable to unlink '.git/index.lock': Operation not permitted
#
# The commit succeeds, the lock survives, and the NEXT git command
# fails with "Another git process seems to be running".
#
# Your shell has no such restriction, so clearing them here works.

set -uo pipefail
cd "$(dirname "$0")"

rm -f .git/index.lock .git/HEAD.lock .git/__probe 2>/dev/null

if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to commit."
  exit 0
fi

echo "Changes to be committed:"
git status --short
echo

git add -A
git commit -m "${1:-Update}"

echo
echo "Done. Push with:  git push origin main"
