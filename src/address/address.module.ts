import { Module } from "@nestjs/common";
import { AddressValidationService } from "./address-validation.service";
import { ADDRESS_VALIDATION_SERVICE } from "./address-validation.service.interface";

@Module({
  providers: [
    AddressValidationService,
    {
      provide: ADDRESS_VALIDATION_SERVICE,
      useExisting: AddressValidationService,
    },
  ],
  exports: [AddressValidationService, ADDRESS_VALIDATION_SERVICE],
})
export class AddressModule {}
