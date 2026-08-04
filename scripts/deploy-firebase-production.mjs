#!/usr/bin/env node

throw new Error(
  "Direct Firebase production mutation is retired from this repository. "
  + "Use the policy-enforcing prepare workflow to produce a verified artifact, then "
  + "promote it through a separately owned trusted deployer."
);
