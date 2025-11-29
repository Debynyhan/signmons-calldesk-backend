import { Global, Module } from "@nestjs/common";
import { ToolRegistryService } from "./tool.provider";

@Global()
@Module({
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}
