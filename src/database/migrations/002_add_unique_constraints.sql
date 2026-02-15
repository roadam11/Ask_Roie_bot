-- Migration 002: Add unique constraints for idempotency
-- Prevents duplicate message processing from WhatsApp webhooks

ALTER TABLE messages
ADD CONSTRAINT messages_whatsapp_message_id_unique
UNIQUE (whatsapp_message_id);

-- Create partial index (only for non-null values)
CREATE UNIQUE INDEX idx_messages_whatsapp_id
ON messages(whatsapp_message_id)
WHERE whatsapp_message_id IS NOT NULL;
