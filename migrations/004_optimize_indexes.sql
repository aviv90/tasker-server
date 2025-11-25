-- Optimize indexes for common queries

-- last_commands: Optimize for finding last command by chat_id
-- This significantly improves performance of "getLastCommand" which is called on every request
CREATE INDEX IF NOT EXISTS idx_last_commands_chat_timestamp ON last_commands(chat_id, timestamp DESC);

-- conversation_summaries: Optimize for retrieving history by chat_id
-- Improves performance of "getConversationSummaries" used for long-term memory
CREATE INDEX IF NOT EXISTS idx_summaries_chat_date ON conversation_summaries(chat_id, summary_date DESC);

-- contacts: Optimize for listing by type sorted by name
-- Improves performance of "getContactsByType"
CREATE INDEX IF NOT EXISTS idx_contacts_type_name ON contacts(type, name ASC);

