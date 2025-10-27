/**
 * Task Store - Manages async task tracking for API routes
 * 
 * Uses PostgreSQL database through conversationManager for persistent storage
 * Allows tasks to survive server restarts and work across multiple instances
 */

const conversationManager = require('../services/conversationManager');

async function set(taskId, data) {
    try {
        const status = data.status || 'pending';
        await conversationManager.saveTask(taskId, status, {
            result: data.status === 'done' ? data : null,
            error: data.error
        });
    } catch (error) {
        console.error('❌ Error setting task in taskStore:', error.message);
    }
}

async function get(taskId) {
    try {
        return await conversationManager.getTask(taskId);
    } catch (error) {
        console.error('❌ Error getting task from taskStore:', error.message);
        return null;
    }
}

module.exports = { set, get };