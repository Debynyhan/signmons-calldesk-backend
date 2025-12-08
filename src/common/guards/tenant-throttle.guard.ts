import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerException, ThrottlerGuard } from "@nestjs/throttler";
import { createHash } from "crypto";

const TENANT_LIMIT_DEFAULT = 30;
const TENANT_TTL_SECONDS = 60;

@Injectable()
export class TenantThrottleGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const tenantId =
      (req?.body as { tenantId?: string })?.tenantId ??
      (req?.query as { tenantId?: string })?.tenantId ??
      (req?.params as { tenantId?: string })?.tenantId ??
      "anonymous";

    return Promise.resolve(
      createHash("sha256").update(String(tenantId)).digest("hex"),
    );
  }

  protected getLimit(context: ExecutionContext): number {
    void context;
    return TENANT_LIMIT_DEFAULT;
  }

  protected getTtl(context: ExecutionContext): number {
    void context;
    return TENANT_TTL_SECONDS;
  }

  protected throwThrottlingException(): never {
    throw new ThrottlerException(
      "Too many requests for this tenant. Please slow down.",
    );
  }
}
