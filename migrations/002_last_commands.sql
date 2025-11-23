-- Last Commands table and updates
-- This includes all fields needed for retry mechanism

CREATE TABLE IF NOT EXISTS last_commands (
  id SERIAL PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  tool VARCHAR(100) NOT NULL,
  tool_args JSONB,
  args JSONB,
  plan JSONB,
  is_multi_step BOOLEAN DEFAULT false,
  prompt TEXT,
  result JSONB,
  failed BOOLEAN DEFAULT false,
  normalized JSONB,
  image_url TEXT,
  video_url TEXT,
  audio_url TEXT,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, message_id)
);

-- Cleanup old constraints if they exist (from legacy versions)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'last_commands_chat_id_key' 
    AND conrelid = 'last_commands'::regclass
  ) THEN
    ALTER TABLE last_commands DROP CONSTRAINT last_commands_chat_id_key;
  END IF;
END $$;

-- Ensure unique constraint on chat_id + message_id
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'last_commands_chat_message_unique' 
    AND conrelid = 'last_commands'::regclass
  ) THEN
    ALTER TABLE last_commands ADD CONSTRAINT last_commands_chat_message_unique UNIQUE(chat_id, message_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_last_commands_chat_id ON last_commands(chat_id);
CREATE INDEX IF NOT EXISTS idx_last_commands_timestamp ON last_commands(timestamp DESC);

