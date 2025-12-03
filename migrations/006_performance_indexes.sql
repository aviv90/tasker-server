-- Performance Indexes Optimization
-- Adds composite indexes to speed up common queries

-- 1. Optimize conversation history retrieval
-- Current query uses: WHERE chat_id = $1 ORDER BY timestamp DESC
-- Composite index is much more efficient than separate indexes
CREATE INDEX IF NOT EXISTS idx_conversations_chat_timestamp ON conversations(chat_id, timestamp DESC);

-- 2. Optimize message type lookups
-- Current usage: checking if a specific message ID in a chat is from a bot
CREATE INDEX IF NOT EXISTS idx_message_types_chat_msg ON message_types(chat_id, message_id);

-- 3. Optimize agent context lookups
-- Often queried by chat_id to get the latest context
CREATE INDEX IF NOT EXISTS idx_agent_context_chat_updated ON agent_context(chat_id, last_updated DESC);
