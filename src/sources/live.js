// Live sources: polled over HTTP or system counters. They report status for the "Live" panel;
// OpenAI-compatible servers that expose Prometheus /metrics also feed token totals into the store.
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const get = async (url, key, asText) => {
  const res = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return asText ? res.text() : res.json();
};

// ---------- Ollama ----------
export const ollama = {
  info: {
    type: 'ollama', label: 'Ollama', kind: 'live',
    fields: [{ key: 'url', label: 'Server URL', default: 'http://127.0.0.1:11434' }],
    help: {
      what: 'Ollama runs open models on your own computer. The monitor shows which models are loaded and how much GPU memory they hold.',
      steps: [
        'Install Ollama from ollama.com and start it (tray icon, or "ollama serve").',
        'Leave the URL empty for the default http://127.0.0.1:11434, or enter the address of another computer, e.g. http://192.168.1.20:11434.',
        'Press Test. "Running, no model loaded" is normal until you run a model.',
      ],
      tips: 'Ollama does not keep a usage log, so per-request tokens are not counted. Local models cost $0.',
    },
  },
  create(cfg) {
    const url = (cfg.url || this.info.fields[0].default).replace(/\/$/, '');
    return {
      async status() {
        try {
          const ps = await get(`${url}/api/ps`);
          return {
            ok: true,
            note: ps.models?.length ? 'Model loaded' : 'Running, no model loaded',
            models: (ps.models || []).map((m) => ({ name: m.name, vramGB: +(m.size_vram / 1e9).toFixed(1), until: m.expires_at })),
          };
        } catch { return { ok: false, note: 'Not running' }; }
      },
    };
  },
};

// ---------- OpenAI-compatible server (LM Studio, llama.cpp, vLLM, SGLang, TensorFold, LiteLLM, ...) ----------
// Prometheus counter names per engine: prompt tokens, generated tokens, running and queued requests.
const PROM = {
  prompt: [/^(?:vllm|sglang|llamacpp|tgi)[:_]prompt_tokens_total(?:\{([^}]*)\})?\s+([\d.e+]+)/m],
  gen: [/^(?:vllm|sglang|llamacpp)[:_](?:generation_tokens_total|tokens_predicted_total)(?:\{([^}]*)\})?\s+([\d.e+]+)/m],
  running: /^(?:vllm[:_]num_requests_running|sglang[:_]num_running_reqs|llamacpp[:_]requests_processing)(?:\{[^}]*\})?\s+([\d.e+]+)/m,
  queued: /^(?:vllm[:_]num_requests_waiting|sglang[:_]num_queue_reqs|llamacpp[:_]requests_deferred)(?:\{[^}]*\})?\s+([\d.e+]+)/m,
  kv: /^(?:vllm[:_](?:gpu_)?cache_usage_perc|sglang[:_]token_usage|llamacpp[:_]kv_cache_usage_ratio)(?:\{[^}]*\})?\s+([\d.e+]+)/m,
};
const sumMatches = (text, re) => {
  const g = new RegExp(re.source, 'gm');
  let sum = 0, found = false, m;
  while ((m = g.exec(text))) { sum += Number(m[2]); found = true; }
  return found ? sum : null;
};

export const openaiCompatible = {
  info: {
    type: 'openai-compatible', label: 'OpenAI-compatible server', kind: 'live',
    fields: [
      { key: 'url', label: 'Base URL (without /v1)', default: 'http://127.0.0.1:1234' },
      { key: 'apiKey', label: 'API key (optional)', secret: true },
      { key: 'metricsPath', label: 'Metrics path (optional)', default: '/metrics' },
    ],
    help: {
      what: 'Any server that speaks the OpenAI API: LM Studio, llama.cpp server, vLLM, SGLang, TensorFold, LiteLLM proxy, or a team GPU box.',
      steps: [
        'Start the server and note its address. LM Studio: Developer tab, Start Server (http://127.0.0.1:1234). llama.cpp: llama-server --metrics (port 8080). vLLM: port 8000. SGLang: port 30000 with --enable-metrics.',
        'Enter the base URL without /v1.',
        'If the server needs a key, paste it in API key. It is stored only on this computer and never shown again.',
        'Press Test. "Up" means the model list answered.',
      ],
      tips: 'If the server exposes Prometheus /metrics, its prompt and generated tokens are counted and you get live tok/s, queue and KV cache. Without it you still see up/down and loaded models.',
    },
  },
  create(cfg, store) {
    const base = (cfg.url || '').replace(/\/$/, '').replace(/\/v1$/, '');
    const app = cfg.name || 'Local server';
    let prev = null, prevTs = 0, rates = {}, model = 'unknown';
    const poll = async () => {
      try {
        const models = await get(`${base}/v1/models`, cfg.apiKey);
        model = models.data?.[0]?.id || model;
      } catch { /* metrics may still work */ }
      try {
        const text = await get(`${base}${cfg.metricsPath || '/metrics'}`, cfg.apiKey, true);
        const now = { prompt: sumMatches(text, PROM.prompt[0]), gen: sumMatches(text, PROM.gen[0]) };
        const one = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
        rates.running = one(PROM.running); rates.queued = one(PROM.queued); rates.kv = one(PROM.kv);
        if (prev && now.prompt != null && now.gen != null) {
          const dIn = Math.max(0, now.prompt - prev.prompt), dOut = Math.max(0, now.gen - prev.gen);
          const secs = (Date.now() - prevTs) / 1000;
          rates.prefill = dIn / secs; rates.decode = dOut / secs;
          if (dIn + dOut > 0) {
            store.push({ ts: Date.now(), app, model, session: `${app} server`, in: dIn, out: dOut, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 });
          }
        }
        if (now.prompt != null) { prev = now; prevTs = Date.now(); }
      } catch { rates = { metrics: false }; }
    };
    let timer;
    return {
      async start() { await poll(); timer = setInterval(poll, 10000); },
      stop() { clearInterval(timer); },
      async status() {
        try {
          const m = await get(`${base}/v1/models`, cfg.apiKey);
          return {
            ok: true,
            note: rates.metrics === false ? 'Up (no /metrics, token totals not tracked)' : 'Up',
            models: (m.data || []).slice(0, 6).map((x) => ({ name: x.id })),
            rates: { ...rates },
          };
        } catch (e) { return { ok: false, note: e.message.includes('401') ? 'Unauthorized: check API key' : 'Not reachable' }; }
      },
    };
  },
};

// ---------- GPU (Windows performance counters; nvidia-smi elsewhere) ----------
export const gpu = {
  info: {
    type: 'gpu', label: 'GPU', kind: 'live',
    fields: [{ key: 'vramGB', label: 'Total VRAM in GB (optional)', default: '' }],
    help: {
      what: 'Graphics card load and memory use, handy when running local models.',
      steps: [
        'Windows: nothing to install; it reads the built-in performance counters (works with AMD, NVIDIA and Intel).',
        'Linux/macOS with NVIDIA: needs nvidia-smi on the PATH.',
        'Optionally type the total VRAM of the card so the dashboard can show "used of total".',
      ],
      tips: 'The GPU is only sampled while a dashboard is open, so it costs nothing in the background.',
    },
  },
  create(cfg) {
    let child = null, last = null, users = 0;
    const startWin = () => {
      child = spawn('typeperf', [
        '\\GPU Engine(*engtype_3D)\\Utilization Percentage',
        '\\GPU Engine(*engtype_Compute*)\\Utilization Percentage',
        '\\GPU Adapter Memory(*)\\Dedicated Usage', '-si', '2'], { windowsHide: true });
      let header = null, buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith('"')) continue;
          const cols = line.slice(1, -1).split('","');
          if (!header) { header = cols; continue; }
          let util3d = 0, compute = 0, mem = 0;
          cols.forEach((v, i) => {
            const h = header[i] || '', n = Number(v) || 0;
            if (h.includes('engtype_3D')) util3d += n;
            else if (h.includes('engtype_Compute')) compute += n;
            else if (h.includes('Dedicated Usage')) mem = Math.max(mem, n);
          });
          last = { util: Math.min(100, Math.max(util3d, compute)), vramGB: +(mem / 2 ** 30).toFixed(1), ts: Date.now() };
        }
      });
      child.on('exit', () => { child = null; });
    };
    const readNvidia = async () => new Promise((resolve) => {
      const p = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits']);
      let out = ''; p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => resolve(null));
      p.on('close', () => {
        const [u, used, total, temp, power] = out.split(',').map(Number);
        resolve(Number.isFinite(u) ? { util: u, vramGB: +(used / 1024).toFixed(1), vramTotalGB: +(total / 1024).toFixed(1), tempC: temp, powerW: power, ts: Date.now() } : null);
      });
    });
    return {
      // Counters only run while someone is watching the dashboard.
      watch(on) {
        users += on ? 1 : -1;
        if (platform() === 'win32') {
          if (users > 0 && !child) startWin();
          if (users <= 0 && child) { child.kill(); child = null; }
        }
      },
      stop() { child?.kill(); },
      async status() {
        if (platform() !== 'win32') last = await readNvidia();
        if (!last || Date.now() - last.ts > 10000) return { ok: false, note: 'Warming up' };
        return { ok: true, gpu: { ...last, vramTotalGB: last.vramTotalGB || Number(cfg.vramGB) || null } };
      },
    };
  },
};

// ---------- Another AI Token Monitor (a VPS, a laptop) ----------
export const remote = {
  info: {
    type: 'remote-monitor', label: 'Remote AI Token Monitor', kind: 'remote',
    fields: [
      { key: 'url', label: 'Monitor URL', default: 'http://100.x.y.z:7788' },
      { key: 'apiKey', label: 'Access token', secret: true },
    ],
    help: {
      what: 'Another computer running AI Token Monitor, for example a VPS where an agent runs, or a second laptop. Its usage is added to this dashboard, labelled with its name.',
      steps: [
        'On the other computer, install this app and start it with "npm run lan".',
        'Open its Settings on that computer and copy the access token.',
        'Here, enter its address (e.g. http://100.64.0.5:7788 over Tailscale) and paste the token.',
      ],
      tips: 'Use a private network such as Tailscale or your home Wi-Fi. Do not expose the port to the internet.',
    },
  },
  create(cfg) {
    const url = (cfg.url || '').replace(/\/$/, '');
    let snap = null, error = null, timer;
    const poll = async () => {
      try { snap = await get(`${url}/api/data`, cfg.apiKey); error = null; } catch (e) { error = e.message; }
    };
    return {
      async start() { await poll(); timer = setInterval(poll, 15000); },
      stop() { clearInterval(timer); },
      snapshot: () => snap,
      async status() { return error ? { ok: false, note: error } : { ok: !!snap, note: snap ? 'Connected' : 'Waiting' }; },
    };
  },
};
