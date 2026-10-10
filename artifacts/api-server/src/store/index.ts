import type { Store } from "./storeContract";
import { MemoryStore } from "./memoryStore";
import { PostgresStore } from "./postgresStore";

/**
 * Storage entry point. The current adapter is in-memory; production must not
 * be switched to PostgreSQL until the durable adapter and integration tests
 * are complete. Typing this as Store forces callers to await Promise-capable
 * methods rather than relying on the current adapter's synchronous behavior.
 */
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in production; refusing to start with in-memory storage");
}

const useMemoryStore = process.env.NODE_ENV === "test" || !process.env.DATABASE_URL;
export const store: Store = useMemoryStore ? new MemoryStore() : new PostgresStore();
