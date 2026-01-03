import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles" as const;

export function Roles(...roles: string[]) {
  return SetMetadata(ROLES_KEY, roles);
}
