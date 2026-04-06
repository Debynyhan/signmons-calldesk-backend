export const VOICE_STREAM_PATH = "/api/voice/stream";

export type VoiceStreamParams = Record<string, string | undefined>;

export type StreamingTwimlOptions = {
  streamUrl: string;
  streamParams?: VoiceStreamParams;
  track?: "inbound" | "both";
  playUrl?: string;
  sayText?: string;
  hangup?: boolean;
  keepAliveSec: number;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export function buildStreamUrl(baseUrl: string, path = VOICE_STREAM_PATH): string {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const httpUrl = `${trimmedBase}${normalizedPath}`;
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace("https://", "wss://");
  }
  if (httpUrl.startsWith("http://")) {
    return httpUrl.replace("http://", "ws://");
  }
  return httpUrl;
}

export function buildStreamingTwiml(options: StreamingTwimlOptions): string {
  const track = options.track ?? "inbound";
  const params = options.streamParams ?? {};
  const parameterTags = Object.entries(params)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(
      ([key, value]) =>
        `<Parameter name="${escapeXml(key)}" value="${escapeXml(
          value ?? "",
        )}"/>`,
    )
    .join("");
  const streamTag = options.hangup
    ? ""
    : `<Start><Stream url="${escapeXml(
        options.streamUrl,
      )}" track="${track}">${parameterTags}</Stream></Start>`;
  const playTag = options.playUrl
    ? `<Play>${escapeXml(options.playUrl)}</Play>`
    : options.sayText
      ? `<Say>${escapeXml(options.sayText)}</Say>`
      : "";
  const tail = options.hangup
    ? "<Hangup/>"
    : `<Pause length="${Math.max(1, options.keepAliveSec)}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${streamTag}${playTag}${tail}</Response>`;
}

export function extractSayMessages(twiml: string): string[] {
  const results: string[] = [];
  const regex = /<Say>(.*?)<\/Say>/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(twiml)) !== null) {
    const raw = unescapeXml(match[1] ?? "");
    const trimmed = raw.trim();
    if (trimmed) {
      results.push(trimmed);
    }
  }
  return results;
}

export function hasHangup(twiml: string): boolean {
  return /<Hangup\b/i.test(twiml);
}
