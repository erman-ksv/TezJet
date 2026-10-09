import type { User, UserRole } from "../types/domain";

export function canUseRole(user: User, activeRole: UserRole): boolean {
  if (activeRole === "admin") return user.role === "admin";
  if (user.role === "admin") return false;
  if (activeRole === "passenger") return true;
  return activeRole === "driver" && user.driverApprovalStatus !== undefined;
}
