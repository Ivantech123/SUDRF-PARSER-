// Captcha solver interface + implementations.
//
// sudrf's captcha is an inline base64 PNG of ~5 distorted alphanumeric chars.
// Two strategies:
//   1. Local OCR via ddddocr (Python, offline, ~90%+ on sudrf-style captchas).
//   2. Remote 2captcha API as a paid fallback (~$1/1000).
//
// The solver is pluggable so the MCP server can be configured per-environment.

export interface CaptchaSolver {
  solve(imageBase64: string): Promise<string>;
}

// ── Local OCR via ddddocr (Python subprocess) ───────────────────────────
// Requires: `pip install ddddocr` (or `uv tool install ddddocr`).
// We shell out to a tiny python one-liner so we don't need a python bridge dep.
export class DdddocrSolver implements CaptchaSolver {
  constructor(private pythonBin?: string) {}

  private async pythonBin_(): Promise<string> {
    if (this.pythonBin) return this.pythonBin;
    if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
    const { execFile } = await import("node:child_process");
    for (const bin of ["python3", "python", "/usr/bin/python3", "/usr/local/bin/python3"]) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(bin, ["--version"], (err) => (err ? reject(err) : resolve()));
        });
        return bin;
      } catch { /* try next */ }
    }
    return "python3";
  }

  async solve(imageBase64: string): Promise<string> {
    const { execFile } = await import("node:child_process");
    const bin = await this.pythonBin_();
    const script = `
import base64, sys
try:
    import ddddocr
except ImportError:
    sys.stderr.write("ddddocr not installed; run: pip install ddddocr\\n")
    sys.exit(2)
img = base64.b64decode(sys.stdin.read())
ocr = ddddocr.DdddOcr(show_ad=False)
sys.stdout.write(ocr.classification(img))
`;
    return new Promise((resolve, reject) => {
      const p = execFile(bin, ["-c", script], (err, stdout, stderr) => {
        if (err) return reject(new Error(`ddddocr failed: ${stderr || err.message}`));
        resolve(stdout.trim());
      });
      p.stdin?.end(imageBase64);
    });
  }
}

// ── Resident ddddocr daemon (persistent process) ────────────────────────
// The one-shot DdddocrSolver above spawns python AND reloads the ddddocr model
// on every single captcha (~0.5–1s of pure startup per solve). For bulk
// collection that dominates wall-clock. This variant keeps one python process
// alive: the model is loaded once, then each captcha is one line of base64 in →
// one line of text out. Solve latency drops to ~30–60ms. Requests are
// serialized through an internal queue so a single daemon is safe to share
// across parallel scrapers.
export class ResidentDdddocrSolver implements CaptchaSolver {
  private proc?: import("node:child_process").ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private buf = "";
  private queue: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  private disposed = false;

  constructor(private pythonBin?: string) {}

  private async pythonBin_(): Promise<string> {
    if (this.pythonBin) return this.pythonBin;
    if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
    const { execFile } = await import("node:child_process");
    for (const bin of ["python3", "python", "/usr/bin/python3", "/usr/local/bin/python3"]) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(bin, ["--version"], (err) => (err ? reject(err) : resolve()));
        });
        return bin;
      } catch { /* try next */ }
    }
    return "python3";
  }

  private async ensure(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { spawn } = await import("node:child_process");
      const bin = await this.pythonBin_();
      const daemon = `
import sys, base64
try:
    import ddddocr
except ImportError:
    sys.stderr.write("ddddocr not installed; run: pip install ddddocr\\n")
    sys.stdout.write("__FATAL__\\n"); sys.stdout.flush(); sys.exit(2)
ocr = ddddocr.DdddOcr(show_ad=False)
sys.stdout.write("__READY__\\n"); sys.stdout.flush()
for line in sys.stdin:
    line = line.strip()
    if not line:
        sys.stdout.write("\\n"); sys.stdout.flush(); continue
    try:
        img = base64.b64decode(line)
        sys.stdout.write(ocr.classification(img).replace("\\n"," ") + "\\n")
    except Exception as e:
        sys.stdout.write("__ERR__ " + str(e).replace("\\n"," ") + "\\n")
    sys.stdout.flush()
`;
      const proc = spawn(bin, ["-u", "-c", daemon], { stdio: ["pipe", "pipe", "pipe"] });
      this.proc = proc;
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => this.onData(chunk));
      proc.on("exit", () => this.onExit());
      proc.on("error", () => this.onExit());
      // Wait for the READY sentinel (model loaded) before accepting work.
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("ddddocr daemon startup timeout")), 60_000);
        const onLine = (chunk: string) => {
          if (chunk.includes("__READY__")) { clearTimeout(to); proc.stdout.off("data", onLine); resolve(); }
          if (chunk.includes("__FATAL__")) { clearTimeout(to); proc.stdout.off("data", onLine); reject(new Error("ddddocr not installed")); }
        };
        proc.stdout.on("data", onLine);
      });
    })();
    return this.ready;
  }

  private onData(chunk: string): void {
    // Ignore the startup sentinels handled during ensure().
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.includes("__READY__") || line.includes("__FATAL__")) continue;
      const job = this.queue.shift();
      if (!job) continue;
      if (line.startsWith("__ERR__")) job.reject(new Error(line.slice(7).trim() || "ddddocr error"));
      else job.resolve(line.trim());
    }
  }

  private onExit(): void {
    this.proc = undefined;
    this.ready = undefined;
    const err = new Error("ddddocr daemon exited");
    for (const job of this.queue.splice(0)) job.reject(err);
  }

  async solve(imageBase64: string): Promise<string> {
    if (this.disposed) throw new Error("solver disposed");
    await this.ensure();
    const proc = this.proc;
    if (!proc) throw new Error("ddddocr daemon unavailable");
    const payload = imageBase64.replace(/^data:\s*image\/\w+;base64,\s*/i, "").replace(/\s+/g, "");
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      proc.stdin.write(payload + "\n", (e) => { if (e) reject(e); });
    });
  }

  close(): void {
    this.disposed = true;
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = undefined;
  }
}

// ── Remote 2captcha fallback ────────────────────────────────────────────
// API: https://2captcha.com/2captcha-api#solving_normal_captchas
export class TwoCaptchaSolver implements CaptchaSolver {
  constructor(private apiKey: string) {}

  async solve(imageBase64: string): Promise<string> {
    const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const submit = await fetch("https://2captcha.com/in.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: this.apiKey,
        method: "base64",
        body: base64,
        json: "1",
      }),
    });
    const sj = await submit.json() as { status: number; request: string };
    if (sj.status !== 1) throw new Error(`2captcha submit failed: ${sj.request}`);
    const id = sj.request;
    // poll for result
    for (let i = 0; i < 30; i++) {
      await sleep(3000);
      const r = await fetch(`https://2captcha.com/res.php?key=${this.apiKey}&action=get&id=${id}&json=1`);
      const rj = await r.json() as { status: number; request: string };
      if (rj.status === 1) return rj.request.trim();
      if (rj.request !== "CAPCHA_NOT_READY") throw new Error(`2captcha error: ${rj.request}`);
    }
    throw new Error("2captcha timeout");
  }
}

// ── Chained solver: try local first, fall back to remote ────────────────
export class ChainedSolver implements CaptchaSolver {
  constructor(private primary: CaptchaSolver, private fallback?: CaptchaSolver) {}
  async solve(imageBase64: string): Promise<string> {
    try {
      return await this.primary.solve(imageBase64);
    } catch (e) {
      if (!this.fallback) throw e;
      return this.fallback.solve(imageBase64);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
