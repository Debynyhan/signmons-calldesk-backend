import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/firebase-auth.guard";

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;

    const impersonatedTenant = this.readImpersonatedTenant(request);
    const tenantId = impersonatedTenant ?? authUser?.tenantId ?? null;

    if (!tenantId) {
      throw new ForbiddenException("Tenant id is required for this resource.");
    }

    if (authUser?.role === "admin") {
      if (authUser.tenantId && authUser.tenantId === tenantId) {
        return true;
      }

      if (impersonatedTenant && impersonatedTenant === tenantId) {
        return true;
      }

      throw new ForbiddenException(
        "Admin impersonation header is required to access another tenant.",
      );
    }

    if (!authUser?.tenantId) {
      throw new ForbiddenException("Tenant claim missing in token.");
    }

    if (authUser.tenantId !== tenantId) {
      throw new ForbiddenException("Tenant mismatch for this resource.");
    }

    return true;
  }

  private readImpersonatedTenant(request: Request): string | null {
    const raw = request.headers["x-impersonated-tenant"];
    if (typeof raw === "string" && raw.trim().length) {
      return raw.trim();
    }
    return null;
  }
}
