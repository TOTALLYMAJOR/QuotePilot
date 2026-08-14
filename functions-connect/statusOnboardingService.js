"use strict";

// Compatibility export for source consumers while the Connect codebase remains
// deploy-empty. The only reviewed runtime path is the command-backed edge
// service; provider calls belong to the separately credentialed worker.
const {
  createStripeConnectStatusOnboardingCommandEdgeService
} = require("./statusOnboardingCommandEdgeService");

module.exports = {
  createStripeConnectStatusOnboardingService: createStripeConnectStatusOnboardingCommandEdgeService
};
