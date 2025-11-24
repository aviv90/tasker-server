/**
 * Location Service
 * 
 * Handles location extraction and random location generation.
 * Refactored to use modular components (Phase 5.3)
 */

import { isLandLocation, buildLocationAckMessage } from './location/helpers';
import { extractRequestedRegion } from './location/extraction';
import { findRandomLocation, getRandomLocationForPrompt } from './location/finder';

export {
  isLandLocation,
  extractRequestedRegion,
  buildLocationAckMessage,
  findRandomLocation,
  getRandomLocationForPrompt
};

