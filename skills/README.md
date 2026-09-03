# 9Router — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use 9Router for you.

> Tip: start with the **9router** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router-web-fetch/SKILL.md |
| **Hermes Agent Toolkit** | https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/hermes-toolkit/SKILL.md |
| **ECC Auto Skill Router** | Local TF-IDF intent router (286 skills catalog) |

## Extended Rules & Skills in 9Router

9Router Extended Studio (`/dashboard/extended`) includes built-in rule sets and tool plugins:
- **`hermes-toolkit`**: Persistent memory bridge syncing `MEMORY.md` and `USER.md` between Hermes Agent and 9Router chat requests.
- **`ecc-auto-skill-router`**: In-memory TF-IDF intent classifier routing incoming prompts to matching domain skills.
- **`taste-skill`**: Anti-AI-slop design variance and motion intensity sliders for frontend UI generation.
- **`caveman` & `ponytail`**: Token-saving system prompt injectors for terse technical communication and YAGNI-first minimalist coding.
- **`commit-lint` & `human-commit`**: Semantic and natural human git commit formatting rules.
- **`human-handwritten`**: Anti-slop authentic prose and writing style rules.
- **`watermarks-remover`**: Zero-width unicode & AI provenance watermark cleaner.
- **`mcp-inspector`**: Inspector and validation tool for Model Context Protocol servers.
- **`graphify`**: Visual knowledge graph builder for codebases and documents.

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/thunderkex/9router-extended/refs/heads/extended/skills/9router/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export NINEROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`.

## Links & Credits

- Source (Extended): https://github.com/thunderkex/9router-extended
- Original Project (Upstream): https://github.com/decolua/9router
- Dashboard: http://localhost:20128/dashboard
