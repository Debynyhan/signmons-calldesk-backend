import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LoggingModule } from "../logging/logging.module";
import { CoverageCheckService } from "./coverage-check.service";

@Module({
  imports: [PrismaModule, LoggingModule],
  providers: [CoverageCheckService],
  exports: [CoverageCheckService],
})
export class CoverageCheckModule {}
