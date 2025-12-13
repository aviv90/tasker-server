-- Create music_tasks table for persistent state management
CREATE TABLE IF NOT EXISTS music_tasks (
  task_id VARCHAR(255) PRIMARY KEY,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  type VARCHAR(50) NOT NULL, -- 'with-lyrics', 'instrumental', 'upload-extend'
  prompt TEXT,
  options JSONB DEFAULT '{}'::jsonb, -- stored musicOptions
  whatsapp_context JSONB, -- context for replying to user
  metadata JSONB DEFAULT '{}'::jsonb, -- additional flags like wantsVideo
  result JSONB, -- final result from callback
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_music_tasks_status ON music_tasks(status);
CREATE INDEX IF NOT EXISTS idx_music_tasks_created_at ON music_tasks(created_at DESC);
