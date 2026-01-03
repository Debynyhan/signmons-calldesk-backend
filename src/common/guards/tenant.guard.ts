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

    const tenantId = this.resolveTenantId(request);
    const impersonatedTenant = this.readImpersonatedTenant(request);

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

  private resolveTenantId(request: Request): string | null {
    const candidate =
      this.pickId((request.body as Record<string, unknown>)?.tenantId) ??
      this.pickId((request.query as Record<string, unknown>)?.tenantId) ??
      this.pickId((request.params as Record<string, unknown>)?.tenantId);

    return candidate ?? null;
  }

  private readImpersonatedTenant(request: Request): string | null {
    const raw = request.headers["x-impersonated-tenant"];
    if (typeof raw === "string" && raw.trim().length) {
      return raw.trim();
    }
    return null;
  }

  private pickId(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number") {
      return value.toString();
    }
    return null;
  }
}
