/**
 * Location service helper functions
 */

const loadJson = (path) => {
  try {
    return require(path);
  } catch (err) {
    console.warn(`⚠️ Could not load ${path}:`, err.message);
    return null;
  }
};

/**
 * Check if location description indicates land (not water)
 */
function isLandLocation(description) {
  if (!description) return false;
  const descLower = description.toLowerCase();

  const landIndicators = [
    'עיר', 'כפר', 'ישוב', 'מדינה', 'רחוב', 'שכונה', 'אזור', 'מחוז', 'מדבר', 'הר', 'עמק', 'יער',
    'city', 'town', 'village', 'country', 'street', 'district', 'region', 'province',
    'desert', 'mountain', 'valley', 'forest', 'park', 'road', 'highway', 'building',
    'neighborhood', 'settlement', 'capital', 'state', 'county', 'rural', 'urban', 'population'
  ];

  if (landIndicators.some(indicator => descLower.includes(indicator))) {
    return true;
  }

  const openWaterKeywords = [
    'אוקיינוס', 'באוקיינוס', 'באמצע האוקיינוס', 'באמצע הים', 'בלב הים',
    'in the ocean', 'in the middle of the ocean', 'in the middle of the sea',
    'open water', 'open ocean', 'deep water', 'deep ocean', 'open sea',
    'atlantic ocean', 'pacific ocean', 'indian ocean', 'arctic ocean',
    'מים פתוחים', 'מים עמוקים', 'אין יבשה', 'no land'
  ];

  return !openWaterKeywords.some(keyword => descLower.includes(keyword));
}

/**
 * Build acknowledgment message for location request
 */
function buildLocationAckMessage(requestedRegion) {
  if (requestedRegion && requestedRegion.displayName) {
    return `🌍 שולח מיקום באזור ${requestedRegion.displayName}...`;
  }
  return '🌍 שולח מיקום אקראי...';
}

module.exports = {
  loadJson,
  isLandLocation,
  buildLocationAckMessage
};

