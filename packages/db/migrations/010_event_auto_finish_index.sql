CREATE INDEX IF NOT EXISTS events_pending_end_idx ON events(ends_at)
 WHERE status IN ('draft', 'published', 'active');
