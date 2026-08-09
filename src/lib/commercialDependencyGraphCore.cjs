"use strict";

// Vite resolves the browser adapter through this stable alias. Keeping this as
// a one-line bridge prevents the browser and deployed Functions from drifting.
module.exports = require("../../functions/commercialDependencyGraphCore.cjs");
