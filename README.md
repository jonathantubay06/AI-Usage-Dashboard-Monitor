<p align="center"><img src="assets/brand/ai-token-monitor-logo-lockup.png" alt="AI Token Monitor" width="560"></p>

# AI Token Monitor

A local dashboard that shows what your AI tools use and roughly what it costs, updated live. It reads the usage logs your tools already write on your own computer. Nothing is uploaded anywhere.

## What it tracks

| Source | How | What you get |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | tokens, est. cost, models, sessions with titles |
| Codex (CLI and app) | `~/.codex/sessions/**/*.jsonl` | tokens, est. cost, models, sessions, 5-hour and weekly plan limit % |
| opencode | `~/.local/share/opencode/opencode.db` (read-only) | tokens, opencode's own cost, models, sessions |
| Ollama | `http://127.0.0.1:11434/api/ps` | which models are loaded and their VRAM |
| OpenAI-compatible server (LM Studio, llama.cpp, vLLM, SGLang, LiteLLM and others) | `/v1/models` and Prometheus `/metrics` | up/down, loaded models, prefill and decode tok/s, running and queued requests, KV cache, and token totals when `/metrics` is exposed |
| GPU | Windows performance counters, or `nvidia-smi` elsewhere | utilisation and VRAM (only sampled while a dashboard is open) |
| Remote AI Token Monitor | another copy of this app on a VPS or laptop | its usage merged into yours |

Views: Overview (totals, today, burn rate, cache share, budgets, daily and 24-hour charts, live feed of each call), Apps, Models, Sessions (search and sort), Live (GPU, local servers, plan limits) and Settings.

## Try the demo

The demo is the same dashboard running on invented data in your browser, with no server and no logs:

```bash
npm run demo
```

then open `dist-demo/index.html` through any static server (for example `npx serve dist-demo`). The included `netlify.toml` deploys exactly this build, so a Netlify site made from this repo shows only fake data.

## Run it on your computer

Needs Node.js 22.5 or newer. The monitor itself needs no packages; `npm install` is only for the optional cloud mirror.

```bash
git clone https://github.com/jonathantubay06/AI-Usage-Dashboard-Monitor.git ai-token-monitor
cd ai-token-monitor
npm start
```

Open http://127.0.0.1:7788. The first start reads every log once (about 15 seconds for 3 GB of Claude Code logs); after that it only reads new lines. On Windows you can also double-click `scripts\Start AI Token Monitor.vbs` (no console window) and stop it with `scripts\stop.ps1`.

## Currency

Costs are tracked in US dollars and can be shown in any currency. The button at the top right opens a searchable list (type a country or currency); the currency for the country you are in is pinned at the top, guessed from your time zone and browser language. Rates come from the free open.er-api.com feed, cached for 12 hours in `data/rates.json`. Budgets are entered in the currency you are viewing and stored in dollars.

## Settings

Open the Settings tab. Every page section explains itself; in short:

- **Sources.** On first run the app adds every tool it finds in its default location. Each source can be switched off, renamed, pointed at another folder or URL, tested, or removed, and has a "How to set up" guide. Use "Add a source" for LM Studio, a llama.cpp or vLLM server, Ollama on another machine, or another monitor.
- **Budget alerts.** Add as many rules as you like: any app or model, today / this week / this month, in dollars or tokens, with a warning percentage. Alerts show on the dashboard, as browser notifications, and optionally as a webhook (ntfy.sh phone push, Slack, Discord or plain JSON). Each rule fires once per period and level.
- **Access from other devices.** See below.

API keys and webhook URLs are stored only in `data/config.json` on the computer running the monitor and are never sent back to the browser.

## Phone, tablet, other laptops

Two ways: on the same network (below), or anywhere through your own free Netlify site with the optional cloud mirror (see [cloud/README.md](cloud/README.md)).


```bash
npm run lan
```

Open `http://<computer-address>:7788` on the other device (same Wi-Fi, or anywhere over Tailscale) and enter the access token shown in Settings on the host. Add the page to the home screen to use it like an app. Do not expose the port to the open internet.

## About the cost numbers

Costs are API-equivalent estimates using the public LiteLLM price list (refreshed daily), the same source ccusage uses. On a subscription plan they show what the usage would cost on the API, not your bill. Local models count as $0.

Not tracked yet: Claude plan limit percentages (Claude Code does not write them to its logs) and Ollama per-request tokens (Ollama has no usage log or metrics endpoint).

## Tests

```bash
npm test
```

## Privacy

`data/` (your token, API keys, webhook URLs, price cache, alert state) is git-ignored, and default paths are written as `~/...`, so a clone of this repository contains nothing from the machine it was built on.

## License

MIT
