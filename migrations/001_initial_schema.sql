-- Initial schema creation
-- Creates all base tables and indexes

-- Conversations table (deprecated usage but kept for history/compatibility)
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_chat_id ON conversations(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp DESC);

-- Voice settings
CREATE TABLE IF NOT EXISTS voice_settings (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default voice settings if empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM voice_settings) THEN
    INSERT INTO voice_settings (enabled) VALUES (false);
  END IF;
END $$;

-- Allow lists
CREATE TABLE IF NOT EXISTS voice_allow_list (
  id SERIAL PRIMARY KEY,
  contact_name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_allow_list (
  id SERIAL PRIMARY KEY,
  contact_name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_creation_allow_list (
  id SERIAL PRIMARY KEY,
  contact_name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks tracking
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  contact_id VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(500),
  contact_name VARCHAR(500),
  type VARCHAR(50),
  chat_id VARCHAR(255),
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);

-- Agent context (Short-term memory)
CREATE TABLE IF NOT EXISTS agent_context (
  id SERIAL PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL UNIQUE,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  generated_assets JSONB DEFAULT '{"images":[],"videos":[],"audio":[]}'::jsonb,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_context_chat_id ON agent_context(chat_id);
CREATE INDEX IF NOT EXISTS idx_agent_context_last_updated ON agent_context(last_updated DESC);

-- Conversation summaries (Long-term memory)
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id SERIAL PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL,
  summary TEXT NOT NULL,
  key_topics JSONB DEFAULT '[]'::jsonb,
  user_preferences JSONB DEFAULT '{}'::jsonb,
  message_count INTEGER DEFAULT 0,
  summary_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_chat_id ON conversation_summaries(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_date ON conversation_summaries(summary_date DESC);

-- Message Types (for role identification)
CREATE TABLE IF NOT EXISTS message_types (
  id SERIAL PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_types_chat_id ON message_types(chat_id);
CREATE INDEX IF NOT EXISTS idx_message_types_message_id ON message_types(message_id);
CREATE INDEX IF NOT EXISTS idx_message_types_type ON message_types(message_type);
CREATE INDEX IF NOT EXISTS idx_message_types_timestamp ON message_types(timestamp DESC);

