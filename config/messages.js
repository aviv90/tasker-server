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
   * @param {string} role - Role ('user', 'bot', or 'assistant')
   * @returns {string} Role message
   */
  getRole(role) {
    if (role === 'user') {
      return this.roles.user;
    } else if (role === 'assistant' || role === 'bot') {
      return this.roles.bot;
    } else {
      return role || 'לא ידוע';
    }
  },

  /**
   * Default sender name
   */
  defaultSenderName: 'המשתמש'
};

