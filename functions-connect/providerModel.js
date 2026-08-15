"use strict";

const { canonicalJson, sha256 } = require("./interfaceContracts");

const SANDBOX_PROVIDER_MODE = "sandbox";
const REVIEWED_CONFIGURATION = Object.freeze({
  country: "US",
  currency: "usd",
  dashboard: "full",
  feesCollector: "stripe",
  lossesCollector: "stripe",
  requirementsCollector: "stripe",
  merchantConfiguration: true,
  cardPaymentsRequested: true,
  chargePattern: "direct",
  platformApplicationFee: false
});
const REVIEWED_CONFIGURATION_DIGEST = sha256(canonicalJson(REVIEWED_CONFIGURATION));

module.exports = {
  REVIEWED_CONFIGURATION,
  REVIEWED_CONFIGURATION_DIGEST,
  SANDBOX_PROVIDER_MODE
};
