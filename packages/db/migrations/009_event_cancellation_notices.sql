ALTER TABLE invitation_deliveries DROP CONSTRAINT IF EXISTS invitation_deliveries_purpose_check;
ALTER TABLE invitation_deliveries ADD CONSTRAINT invitation_deliveries_purpose_check
  CHECK (purpose IN ('invitation', 'event_change', 'event_cancelled'));
