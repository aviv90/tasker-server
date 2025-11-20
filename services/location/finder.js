/**
 * Location finder - finds random locations based on requested region
 */

const { getLocationInfo } = require('../geminiService');
const { continents } = require('./constants');
const { isLandLocation } = require('./helpers');
const { extractRequestedRegion } = require('./extraction');
const { buildLocationAckMessage } = require('./helpers');

/**
 * Find random location within requested region
 * @param {Object} params
 * @param {Object} params.requestedRegion - Requested region info
 * @param {number} params.maxAttempts - Max attempts
 * @param {string} params.language - Output language (default: 'he')
 */
async function findRandomLocation({ requestedRegion, maxAttempts = 15, language = 'he' }) {
  let locationInfo = null;
  let attempts = 0;

  const hasSpecificBounds = requestedRegion && requestedRegion.bounds;

  let availableContinents = continents;

  if (requestedRegion) {
    const requestedRegionName = requestedRegion.continentName;
    const hasMultiRegions = requestedRegion.multiRegions && Array.isArray(requestedRegion.multiRegions);

    if (requestedRegionName && !hasSpecificBounds) {
      if (hasMultiRegions) {
        availableContinents = continents.filter(c => requestedRegion.multiRegions.includes(c.name));
        if (availableContinents.length === 0) {
          availableContinents = continents;
        }
      } else {
        availableContinents = continents.filter(c => c.name === requestedRegionName);
        if (availableContinents.length === 0) {
          availableContinents = continents;
        }
      }
    }
  }

  let useBoundsForGeneration = hasSpecificBounds;

  while (attempts < maxAttempts && !locationInfo) {
    attempts++;

    let latitude;
    let longitude;

    if (useBoundsForGeneration && requestedRegion && requestedRegion.bounds) {
      const bounds = requestedRegion.bounds;
      if (
        bounds &&
        typeof bounds.minLat === 'number' && typeof bounds.maxLat === 'number' &&
        typeof bounds.minLng === 'number' && typeof bounds.maxLng === 'number' &&
        bounds.minLat < bounds.maxLat && bounds.minLng < bounds.maxLng &&
        bounds.minLat >= -90 && bounds.maxLat <= 90 &&
        bounds.minLng >= -180 && bounds.maxLng <= 180
      ) {
        latitude = (Math.random() * (bounds.maxLat - bounds.minLat) + bounds.minLat).toFixed(6);
        longitude = (Math.random() * (bounds.maxLng - bounds.minLng) + bounds.minLng).toFixed(6);
      } else {
        useBoundsForGeneration = false;
      }
    }

    if (!useBoundsForGeneration || !latitude || !longitude) {
      const totalWeight = availableContinents.reduce((sum, c) => sum + c.weight, 0) || 1;
      let randomWeight = Math.random() * totalWeight;
      let selectedContinent = availableContinents[0] || continents[0];

      for (const continent of availableContinents) {
        randomWeight -= continent.weight;
        if (randomWeight <= 0) {
          selectedContinent = continent;
          break;
        }
      }

      latitude = (Math.random() * (selectedContinent.maxLat - selectedContinent.minLat) + selectedContinent.minLat).toFixed(6);
      longitude = (Math.random() * (selectedContinent.maxLng - selectedContinent.minLng) + selectedContinent.minLng).toFixed(6);
    }

    const tempLocationInfo = await getLocationInfo(parseFloat(latitude), parseFloat(longitude), language);

    if (tempLocationInfo.success && tempLocationInfo.description) {
      if (isLandLocation(tempLocationInfo.description)) {
        locationInfo = { ...tempLocationInfo, latitude, longitude };
      }
    }
  }

  if (!locationInfo) {
    return {
      success: false,
      error: language === 'he' 
        ? `לא הצלחתי למצוא מיקום תקין אחרי ${maxAttempts} ניסיונות`
        : `Could not find a valid location after ${maxAttempts} attempts`
    };
  }

  return {
    success: true,
    latitude: locationInfo.latitude,
    longitude: locationInfo.longitude,
    description: locationInfo.description,
    regionName: requestedRegion?.displayName || null,
    isCity: requestedRegion?.isCity === true
  };
}

/**
 * Get random location for prompt
 */
async function getRandomLocationForPrompt(prompt) {
  const requestedRegion = await extractRequestedRegion(prompt || '');
  const ackMessage = buildLocationAckMessage(requestedRegion);
  const locationResult = await findRandomLocation({ requestedRegion });
  return {
    ...locationResult,
    ackMessage,
    requestedRegion
  };
}

module.exports = {
  findRandomLocation,
  getRandomLocationForPrompt
};

