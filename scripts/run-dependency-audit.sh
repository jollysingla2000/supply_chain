#!/usr/bin/env bash
set -euo pipefail

npm install --package-lock-only --ignore-scripts --no-audit

audit_exit=0
npm audit --audit-level=low --json > npm-audit.json || audit_exit=$?

node -e "const a=require('./npm-audit.json'); const vulns=Object.entries(a.vulnerabilities||{}); console.log('Dependency audit summary: ' + vulns.length + ' package advisory group(s)'); for (const [name,v] of vulns) { console.log(name + ': severity=' + v.severity + ', direct=' + v.isDirect + ', range=' + v.range + ', fixAvailable=' + JSON.stringify(v.fixAvailable)); for (const x of v.via||[]) if (typeof x === 'object') console.log('  advisory=' + x.title + ', range=' + x.range + ', url=' + x.url); }"

exit "$audit_exit"
