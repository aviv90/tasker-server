-- Final Performance Optimization
-- Composite index for conversation summaries for faster long-term memory retrieval

CREATE INDEX IF NOT EXISTS idx_summaries_chat_date ON conversation_summaries(chat_id, summary_date DESC);
