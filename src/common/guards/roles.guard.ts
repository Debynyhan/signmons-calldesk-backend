import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/firebase-auth.guard";
import { ROLES_KEY } from "../decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;

    if (!authUser?.role) {
      throw new ForbiddenException("Role is required for this resource.");
    }

    if (!requiredRoles.includes(authUser.role)) {
      throw new ForbiddenException("Insufficient role for this resource.");
    }

    return true;
  }
}
