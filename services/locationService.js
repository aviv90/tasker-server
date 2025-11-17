/**
 * Location Service
 * 
 * Handles location extraction and random location generation.
 * Refactored to use modular components (Phase 5.3)
 */

const { isLandLocation, buildLocationAckMessage } = require('./location/helpers');
const { extractRequestedRegion } = require('./location/extraction');
const { findRandomLocation, getRandomLocationForPrompt } = require('./location/finder');

module.exports = {
  isLandLocation,
  extractRequestedRegion,
  buildLocationAckMessage,
  findRandomLocation,
  getRandomLocationForPrompt
};
