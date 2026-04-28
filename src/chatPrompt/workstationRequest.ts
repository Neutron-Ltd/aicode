import { OPENAI_TOOLS } from "./openAiTools";
import { sanitizeChatMessages, type OpenAIChatMessage } from "./sanitizeMessages";

const CHAT_TEMPERATURE = 0.7;

export function buildWorkstationChatRequestBody(
  upstreamModel: string,
  messages: OpenAIChatMessage[]
): Record<string, unknown> {
  return {
    model: upstreamModel,
    messages: sanitizeChatMessages(messages),
    stream: true,
    temperature: CHAT_TEMPERATURE,
    stream_options: { include_usage: true },
    tools: OPENAI_TOOLS,
    tool_choice: "auto",
  };
}
