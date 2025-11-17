/**
 * Centralized Messages Configuration
 * All user-facing text messages in one place for easy maintenance and updates
 */

module.exports = {
  /**
   * Entity types (for group/contact operations)
   */
  entityTypes: {
    group: 'קבוצה',
    contact: 'איש קשר'
  },

  /**
   * Get entity type message
   * @param {boolean} isGroup - Whether it's a group
   * @returns {string} Entity type message
   */
  getEntityType(isGroup) {
    return isGroup ? this.entityTypes.group : this.entityTypes.contact;
  },

  /**
   * User roles (for message history formatting)
   */
  roles: {
    user: 'משתמש',
    bot: 'בוט'
  },

  /**
   * Get role message
   * @param {string} role - Role ('user' or 'bot')
   * @returns {string} Role message
   */
  getRole(role) {
    return role === 'user' ? this.roles.user : this.roles.bot;
  },

  /**
   * Default sender name
   */
  defaultSenderName: 'המשתמש'
};

