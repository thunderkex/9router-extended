import fs from "fs";
import { getHermesEnvPath } from "./paths.js";

const TELEGRAM_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USERS",
  "TELEGRAM_ALLOW_ALL_USERS",
  "TELEGRAM_GROUP_ALLOWED_CHATS",
  "TELEGRAM_HOME_CHANNEL",
  "TELEGRAM_HOME_CHANNEL_NAME",
  "TELEGRAM_CRON_THREAD_ID",
  "TELEGRAM_WEBHOOK_URL",
  "TELEGRAM_WEBHOOK_PORT",
  "TELEGRAM_WEBHOOK_SECRET",
  "GATEWAY_ALLOW_ALL_USERS",
];

export function getTelegramConfig() {
  const envPath = getHermesEnvPath();
  const config = {
    botToken: "",
    allowedUsers: "",
    allowAllUsers: false,
    groupAllowedChats: "",
    gatewayAllowAll: false,
    homeChannel: "",
    homeChannelName: "",
    cronThreadId: "",
    webhookUrl: "",
    webhookPort: "",
    webhookSecret: "",
    enabled: false,
  };

  if (!fs.existsSync(envPath)) {
    return config;
  }

  try {
    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      if (key === "TELEGRAM_BOT_TOKEN") config.botToken = val;
      if (key === "TELEGRAM_ALLOWED_USERS") config.allowedUsers = val;
      if (key === "TELEGRAM_ALLOW_ALL_USERS") config.allowAllUsers = val.toLowerCase() === "true" || val === "1";
      if (key === "TELEGRAM_GROUP_ALLOWED_CHATS") config.groupAllowedChats = val;
      if (key === "GATEWAY_ALLOW_ALL_USERS") config.gatewayAllowAll = val.toLowerCase() === "true" || val === "1";
      if (key === "TELEGRAM_HOME_CHANNEL") config.homeChannel = val;
      if (key === "TELEGRAM_HOME_CHANNEL_NAME") config.homeChannelName = val;
      if (key === "TELEGRAM_CRON_THREAD_ID") config.cronThreadId = val;
      if (key === "TELEGRAM_WEBHOOK_URL") config.webhookUrl = val;
      if (key === "TELEGRAM_WEBHOOK_PORT") config.webhookPort = val;
      if (key === "TELEGRAM_WEBHOOK_SECRET") config.webhookSecret = val;
    }
  } catch {
    // fallback default
  }

  config.enabled = Boolean(config.botToken);
  return config;
}

export function saveTelegramConfig(updates = {}) {
  const envPath = getHermesEnvPath();
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  }

  const map = {
    TELEGRAM_BOT_TOKEN: updates.botToken?.trim() ?? "",
    TELEGRAM_ALLOWED_USERS: updates.allowedUsers?.trim() ?? "",
    TELEGRAM_ALLOW_ALL_USERS: updates.allowAllUsers !== undefined ? (updates.allowAllUsers ? "true" : "") : "true",
    TELEGRAM_GROUP_ALLOWED_CHATS: updates.groupAllowedChats?.trim() ?? "*",
    GATEWAY_ALLOW_ALL_USERS: updates.gatewayAllowAll ? "true" : "",
    TELEGRAM_HOME_CHANNEL: updates.homeChannel?.trim() ?? "",
    TELEGRAM_HOME_CHANNEL_NAME: updates.homeChannelName?.trim() ?? "",
    TELEGRAM_CRON_THREAD_ID: updates.cronThreadId?.trim() ?? "",
    TELEGRAM_WEBHOOK_URL: updates.webhookUrl?.trim() ?? "",
    TELEGRAM_WEBHOOK_PORT: updates.webhookPort?.trim() ?? "",
    TELEGRAM_WEBHOOK_SECRET: updates.webhookSecret?.trim() ?? "",
  };

  const lines = content.split(/\r?\n/);
  const foundKeys = new Set();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    // match either KEY=... or commented # KEY=... or # TELEGRAM_KEY=...
    for (const key of TELEGRAM_KEYS) {
      const activeMatch = trimmed.startsWith(`${key}=`);
      const commentMatch = /^#\s*TELEGRAM_[A-Z_]+(\s*=.*)?$/.test(trimmed) && (trimmed.includes(`${key}=`) || trimmed === `# ${key}`);

      if (activeMatch || commentMatch) {
        foundKeys.add(key);
        const val = map[key];
        if (!val) {
          return `# ${key}=`;
        }
        return `${key}=${val}`;
      }
    }
    return line;
  });

  // Append keys that weren't found
  const appendBlock = [];
  for (const key of TELEGRAM_KEYS) {
    if (!foundKeys.has(key)) {
      const val = map[key];
      if (val) {
        appendBlock.push(`${key}=${val}`);
      }
    }
  }

  if (appendBlock.length > 0) {
    newLines.push(...appendBlock);
  }

  fs.writeFileSync(envPath, newLines.join("\n"), "utf8");
  return getTelegramConfig();
}
