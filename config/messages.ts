/**
 * Centralized Messages Configuration
 * All user-facing text messages in one place for easy maintenance and updates
 */

/**
 * Entity types (for group/contact operations)
 */
export const entityTypes = {
  group: 'קבוצה',
  contact: 'איש קשר'
} as const;

/**
 * Get entity type message
 * @param isGroup - Whether it's a group
 * @returns Entity type message in Hebrew
 */
export function getEntityType(isGroup: boolean): EntityType {
  return isGroup ? entityTypes.group : entityTypes.contact;
}

/**
 * User roles (for message history formatting)
 */
export const roles = {
  user: 'משתמש',
  bot: 'בוט'
} as const;

/**
 * Supported role types
 */
export type RoleType = 'user' | 'bot' | 'assistant' | string;

/**
 * Get role message
 * @param role - Role ('user', 'bot', or 'assistant')
 * @returns Role message in Hebrew
 */
export function getRole(role: RoleType): Role | string {
  if (role === 'user') {
    return roles.user;
  } else if (role === 'assistant' || role === 'bot') {
    return roles.bot;
  } else {
    return role || 'לא ידוע';
  }
}

/**
 * Default sender name
 */
export const defaultSenderName = 'המשתמש';

// Type definitions
export type EntityType = typeof entityTypes[keyof typeof entityTypes];
export type Role = typeof roles[keyof typeof roles];

// Default export for ES6 compatibility
export default {
  entityTypes,
  getEntityType,
  roles,
  getRole,
  defaultSenderName
};

