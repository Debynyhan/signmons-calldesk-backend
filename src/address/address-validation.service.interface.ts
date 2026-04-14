export const ADDRESS_VALIDATION_SERVICE = "ADDRESS_VALIDATION_SERVICE";

export interface IAddressValidationService {
  validateConfirmedAddress(params: {
    tenantId: string;
    conversationId: string;
    address: string;
    callSid?: string;
    sourceEventId?: string | null;
  }): string;
}
