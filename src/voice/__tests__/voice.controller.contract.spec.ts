import type { Request, Response } from "express";
import { VoiceController } from "../voice.controller";

describe("VoiceController contract", () => {
  const makeUseCase = () => ({
    handleInbound: jest.fn(),
    handleDemoInbound: jest.fn(),
    handleTurn: jest.fn(),
    handleFallback: jest.fn(),
  });

  const req = {} as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("delegates inbound webhook requests to VoiceInboundUseCase", async () => {
    const useCase = makeUseCase();
    useCase.handleInbound.mockResolvedValue("inbound-result");
    const controller = new VoiceController(useCase as never);

    const result = await controller.handleInbound(req, res, {} as never);

    expect(useCase.handleInbound).toHaveBeenCalledWith(req, res);
    expect(result).toBe("inbound-result");
  });

  it("delegates demo inbound webhook requests to VoiceInboundUseCase", async () => {
    const useCase = makeUseCase();
    useCase.handleDemoInbound.mockResolvedValue("demo-result");
    const controller = new VoiceController(useCase as never);

    const result = await controller.handleDemoInbound(req, res, {} as never);

    expect(useCase.handleDemoInbound).toHaveBeenCalledWith(req, res);
    expect(result).toBe("demo-result");
  });

  it("delegates turn webhook requests to VoiceInboundUseCase", async () => {
    const useCase = makeUseCase();
    useCase.handleTurn.mockResolvedValue("turn-result");
    const controller = new VoiceController(useCase as never);

    const result = await controller.handleTurn(req, res, {} as never);

    expect(useCase.handleTurn).toHaveBeenCalledWith(req, res);
    expect(result).toBe("turn-result");
  });

  it("delegates fallback webhook requests to VoiceInboundUseCase", async () => {
    const useCase = makeUseCase();
    useCase.handleFallback.mockResolvedValue("fallback-result");
    const controller = new VoiceController(useCase as never);

    const result = await controller.handleFallback(req, res, {} as never);

    expect(useCase.handleFallback).toHaveBeenCalledWith(req, res);
    expect(result).toBe("fallback-result");
  });

  it("returns HTTP 200 for status endpoint", () => {
    const controller = new VoiceController(makeUseCase() as never);

    controller.handleStatus(req, res);

    expect((res as unknown as { status: jest.Mock }).status).toHaveBeenCalledWith(200);
    expect((res as unknown as { send: jest.Mock }).send).toHaveBeenCalled();
  });
});
