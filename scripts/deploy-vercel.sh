#!/usr/bin/env bash
set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "Installing Vercel CLI..."
  npm install -g vercel
fi

if [[ ! -f .vercel/project.json ]]; then
  echo "Linking project (first run only)..."
  vercel link
fi

echo "Deploying preview build to Vercel..."
vercel --yes

echo "Done. Use 'npm run vercel:prod' when you want a production deployment."