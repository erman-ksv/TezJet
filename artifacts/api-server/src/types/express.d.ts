import type { Server } from "socket.io";
import type { Locale, User, UserRole } from "./domain";

export interface AuthContext {
  userId: string;
  role: UserRole;
  locale: Locale;
  user: User;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      realtime?: Server;
    }
  }
}