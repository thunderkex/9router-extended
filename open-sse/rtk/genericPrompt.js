import { injectSystemPrompt } from "./systemInject.js";

export function injectGenericPrompt(body, format, promptText) {
  if (!body || !promptText) return;
  injectSystemPrompt(body, format, promptText);
}

