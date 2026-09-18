# Saved mappings are migrated once, not read tolerantly forever

Changes to the saved speaker-mapping shape use version-gated migrations. After a migration, all reads accept only the current shape.

A tolerant reader has no natural expiry: legacy branches remain in every read path with no evidence that they are safe to remove. A stored version lets each migration run once and become removable when no supported installation can still contain the old shape.
