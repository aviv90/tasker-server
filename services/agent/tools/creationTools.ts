/**
 * Creation Tools - Image, Video, Music, Poll generation
 * Clean, modular tool definitions following SOLID principles
 * 
 * This file re-exports tools from separate modules for backward compatibility.
 * Individual tools are now in their own files for better maintainability.
 */

// Re-export all creation tools from separate modules
export {
  create_image,
  create_video,
  image_to_video,
  create_music,
  create_poll
} from './creation';

// Backward compatibility: CommonJS export
const creationTools = require('./creation');
module.exports = creationTools;
