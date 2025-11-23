-- Ensure all columns exist in last_commands (for existing DBs that might be partial)
-- This migration is idempotent - it checks existence before adding

DO $$ 
BEGIN
  -- tool_args
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='tool_args') THEN
    ALTER TABLE last_commands ADD COLUMN tool_args JSONB;
  END IF;

  -- plan
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='plan') THEN
    ALTER TABLE last_commands ADD COLUMN plan JSONB;
  END IF;

  -- is_multi_step
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='is_multi_step') THEN
    ALTER TABLE last_commands ADD COLUMN is_multi_step BOOLEAN DEFAULT false;
  END IF;

  -- prompt
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='prompt') THEN
    ALTER TABLE last_commands ADD COLUMN prompt TEXT;
  END IF;

  -- result
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='result') THEN
    ALTER TABLE last_commands ADD COLUMN result JSONB;
  END IF;

  -- failed
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='failed') THEN
    ALTER TABLE last_commands ADD COLUMN failed BOOLEAN DEFAULT false;
  END IF;

  -- normalized
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='normalized') THEN
    ALTER TABLE last_commands ADD COLUMN normalized JSONB;
  END IF;

  -- image_url
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='image_url') THEN
    ALTER TABLE last_commands ADD COLUMN image_url TEXT;
  END IF;

  -- video_url
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='video_url') THEN
    ALTER TABLE last_commands ADD COLUMN video_url TEXT;
  END IF;

  -- audio_url
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='last_commands' AND column_name='audio_url') THEN
    ALTER TABLE last_commands ADD COLUMN audio_url TEXT;
  END IF;
END $$;

