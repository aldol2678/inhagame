// This fixture executes actual migration SQL inside one in-memory PostgreSQL engine.
// Synthetic auth/provider tables are intentional; it is not Supabase or concurrent PostgreSQL.
process.env.PGLITE_MODULE = import.meta.resolve('@electric-sql/pglite');
await import('../room-chat-sql-candidate.mjs');
