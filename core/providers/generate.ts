import type { AppSettings, ProviderId } from "@/lib/storage/settings";
import { getNineRouterKey, getOpenAIKey } from "@/lib/storage/settings";
import { codexImageModels } from "@/lib/codex/client";
import { discoverNineRouterImageModels } from "@/lib/nine-router/client";
import { discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { CodexOAuthImageProvider } from "./codex-oauth-provider";
import { ManualImageProvider } from "./manual-provider";
import { NineRouterImageProvider } from "./nine-router-provider";
import { OpenAIImageProvider } from "./openai-provider";
import type { GeneratedVisual, ProviderGenerateInput } from "./types";

interface GenerationContext extends ProviderGenerateInput {
  settings: AppSettings;
}

type ProviderHandler = (context: GenerationContext) => Promise<GeneratedVisual>;

const handlers: Record<ProviderId, ProviderHandler> = {
  manual: async (context) => new ManualImageProvider().generate(context),
  openai: async (context) => {
    if (context.settings.openaiAuthMode === "codex-oauth") {
      const model = context.settings.imageModel === "auto" ? codexImageModels[0].id : context.settings.imageModel;
      return new CodexOAuthImageProvider().generate({ ...context, model });
    }
    const apiKey = await getOpenAIKey();
    if (!apiKey) throw new Error("Hãy thêm khóa OpenAI trong Cài đặt trước khi tạo ảnh.");
    const model = resolveImageModel(context.settings.imageModel, await discoverImageModels(apiKey));
    return new OpenAIImageProvider(apiKey).generate({ ...context, model });
  },
  "nine-router": async (context) => {
    const apiKey = await getNineRouterKey();
    const models = await discoverNineRouterImageModels(context.settings.nineRouterUrl, apiKey);
    const model = context.settings.imageModel === "auto" ? models[0]?.id : context.settings.imageModel;
    if (!model) throw new Error("Hãy nhập model ảnh 9Router.");
    return new NineRouterImageProvider(context.settings.nineRouterUrl, apiKey).generate({ ...context, model });
  },
};

export async function generateVisual(provider: ProviderId, context: GenerationContext) {
  return handlers[provider](context);
}
