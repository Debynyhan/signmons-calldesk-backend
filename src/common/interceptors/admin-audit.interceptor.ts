import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createHash } from "crypto";
import { finalize, tap } from "rxjs";
import type { Observable } from "rxjs";
import { LoggingService } from "../../logging/logging.service";

type AdminAuditOutcome = "success" | "error";

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    let outcome: AdminAuditOutcome = "success";

    return next.handle().pipe(
      tap({
        error: () => {
          outcome = "error";
        },
      }),
      finalize(() => {
        const payload = {
          event: "admin.audit",
          recordedAt: new Date().toISOString(),
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: this.resolveClientIp(request),
          statusCode: response.statusCode,
          durationMs: Math.max(0, Date.now() - startedAt),
          credentialHeader: this.resolveCredentialHeader(request),
          adminCredentialFingerprint:
            this.resolveCredentialFingerprint(request),
          outcome,
        };

        if (outcome === "error") {
          this.loggingService.warn(payload, AdminAuditInterceptor.name);
          return;
        }

        this.loggingService.log(payload, AdminAuditInterceptor.name);
      }),
    );
  }

  private resolveCredentialHeader(request: Request): string | null {
    if (request.header("x-admin-api-key")) {
      return "x-admin-api-key";
    }
    if (request.header("x-admin-token")) {
      return "x-admin-token";
    }
    return null;
  }

  private resolveCredentialFingerprint(request: Request): string | null {
    const credential =
      request.header("x-admin-api-key") ?? request.header("x-admin-token");
    if (!credential) {
      return null;
    }
    return createHash("sha256").update(credential).digest("hex").slice(0, 16);
  }

  private resolveClientIp(request: Request): string | null {
    const forwardedFor = request.header("x-forwarded-for");
    if (forwardedFor) {
      const first = forwardedFor.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }

    if (request.ip) {
      return request.ip;
    }

    if (Array.isArray(request.ips) && request.ips.length > 0) {
      return request.ips[0] ?? null;
    }

    return null;
  }
}
