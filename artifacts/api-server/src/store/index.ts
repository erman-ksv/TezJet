import type { Store } from "./storeContract";
import { MemoryStore } from "./memoryStore";

/**
 * Storage entry point. The current adapter is in-memory; production must not
 * be switched to PostgreSQL until the durable adapter and integration tests
 * are complete. Typing this as Store forces callers to await Promise-capable
 * methods rather than relying on the current adapter's synchronous behavior.
 */
export const store: Store = new MemoryStore();
