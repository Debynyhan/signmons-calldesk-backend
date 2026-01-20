import { Injectable, Inject } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import { LoggingService } from "../logging/logging.service";

@Injectable()
export class AddressValidationService {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly loggingService: LoggingService,
  ) {}

  async validateConfirmedAddress(params: {
    tenantId: string;
    conversationId: string;
    address: string;
    callSid?: string;
    sourceEventId?: string | null;
  }): Promise<string> {
    if (this.config.addressValidationProvider !== "google") {
      return params.address;
    }
    if (!this.config.googlePlacesApiKey) {
      this.loggingService.warn(
        {
          event: "address.validation_skipped",
          reason: "missing_places_key",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          sourceEventId: params.sourceEventId ?? undefined,
        },
        AddressValidationService.name,
      );
      return params.address;
    }
    // Placeholder: integrate Google Places validation after confirmation only.
    return params.address;
  }
}
