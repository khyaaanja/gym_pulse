-- A recovery message that was skipped or failed is logged as such, never as sent.
ALTER TYPE "RecoveryEventType" ADD VALUE 'MESSAGE_NOT_SENT';
