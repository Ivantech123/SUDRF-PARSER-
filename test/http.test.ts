import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  HostGate,
  SudrfAntibotError,
  SudrfHttpError,
  backoffDelayMs,
  collectCookies,
  courtFetchUrl,
  isAntibotHtml,
  isRetryableNetworkError,
  isRetryableStatus,
  isTlsOrSslError,
  parseRetryAfter,
  shouldRetryWithHttp,
} from "../src/sudrf/http.js";

describe("courtFetchUrl", () => {
  test("defaults to https and honours the registry http flag", () => {
    assert.equal(
      courtFetchUrl("vs--mor", "/modules.php?name=sud_delo"),
      "https://vs--mor.sudrf.ru/modules.php?name=sud_delo",
    );
    assert.equal(courtFetchUrl("vs--mor", "/", true), "http://vs--mor.sudrf.ru/");
  });
});

describe("isRetryableStatus", () => {
  test("retries rate limits and server faults", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableStatus(s), true, `${s} should retry`);
    }
  });

  test("does not retry stable answers", () => {
    // 403/404 are final: the body is a real page, so the caller gets it back
    // instead of us burning the retry budget.
    for (const s of [200, 301, 400, 401, 403, 404, 410]) {
      assert.equal(isRetryableStatus(s), false, `${s} should not retry`);
    }
  });
});

describe("parseRetryAfter", () => {
  test("reads delta-seconds", () => {
    assert.equal(parseRetryAfter("30", 0, 600_000), 30_000);
    assert.equal(parseRetryAfter("0", 0, 600_000), 0);
  });

  test("reads an HTTP-date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const at = new Date(now + 45_000).toUTCString();
    assert.equal(parseRetryAfter(at, now, 600_000), 45_000);
  });

  test("clamps a hostile value to the cap", () => {
    // "Retry-After: 86400" must not park a worker for a day.
    assert.equal(parseRetryAfter("86400", 0, 60_000), 60_000);
  });

  test("returns null for absent or unparseable values so backoff takes over", () => {
    assert.equal(parseRetryAfter(undefined, 0), null);
    assert.equal(parseRetryAfter("", 0), null);
    assert.equal(parseRetryAfter("   ", 0), null);
    assert.equal(parseRetryAfter("soon", 0), null);
  });

  test("ignores a date already in the past", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(parseRetryAfter(new Date(now - 5_000).toUTCString(), now), null);
  });
});

describe("backoffDelayMs", () => {
  test("doubles the jitter window per attempt", () => {
    const max = () => 1;
    assert.equal(backoffDelayMs(0, 800, 100_000, max), 800);
    assert.equal(backoffDelayMs(1, 800, 100_000, max), 1600);
    assert.equal(backoffDelayMs(2, 800, 100_000, max), 3200);
  });

  test("respects the cap", () => {
    assert.equal(backoffDelayMs(20, 800, 15_000, () => 1), 15_000);
  });

  test("applies full jitter so parallel courts do not retry in lockstep", () => {
    assert.equal(backoffDelayMs(3, 800, 100_000, () => 0), 0);
    assert.equal(backoffDelayMs(3, 800, 100_000, () => 0.5), 3200);
  });

  test("never returns a negative delay", () => {
    assert.ok(backoffDelayMs(-5, 800, 15_000, () => 0.5) >= 0);
  });
});

describe("isRetryableNetworkError", () => {
  test("retries transient transport faults, including nested causes", () => {
    assert.equal(isRetryableNetworkError(new Error("socket hang up")), true);
    assert.equal(isRetryableNetworkError(new Error("other side closed")), true);
    assert.equal(
      isRetryableNetworkError(new Error("fetch failed", { cause: new Error("ECONNRESET") })),
      true,
    );
    const coded = Object.assign(new Error("connect failed"), { code: "ETIMEDOUT" });
    assert.equal(isRetryableNetworkError(coded), true);
  });

  test("never retries our own typed outcomes", () => {
    // An antibot challenge needs Playwright, and a SudrfHttpError already
    // spent the budget — retrying either just wastes requests.
    assert.equal(isRetryableNetworkError(new SudrfAntibotError("https://x.sudrf.ru/")), false);
    assert.equal(isRetryableNetworkError(new SudrfHttpError("503", 503, "u", 4)), false);
  });

  test("retries a transient DNS failure but not an unknown host", () => {
    // A bad subdomain is permanent; retrying it four times per unknown court
    // across ~2269 registry entries is pure waste.
    const notFound = Object.assign(new Error("getaddrinfo ENOTFOUND nope.sudrf.ru"), {
      code: "ENOTFOUND",
    });
    assert.equal(isRetryableNetworkError(notFound), false);

    const dnsBlip = Object.assign(new Error("getaddrinfo EAI_AGAIN vs--mor.sudrf.ru"), {
      code: "EAI_AGAIN",
    });
    assert.equal(isRetryableNetworkError(dnsBlip), true);
  });

  test("does not retry programmer errors", () => {
    assert.equal(isRetryableNetworkError(new TypeError("x is not a function")), false);
  });
});

describe("TLS fallback", () => {
  test("detects certificate and handshake failures through the cause chain", () => {
    assert.equal(isTlsOrSslError(new Error("unable to verify the first certificate")), true);
    assert.equal(
      isTlsOrSslError(new Error("fetch failed", { cause: new Error("wrong version number") })),
      true,
    );
    assert.equal(isTlsOrSslError(new Error("404 not found")), false);
  });

  test("only falls back to plain HTTP when HTTPS was the scheme that failed", () => {
    const tls = new Error("ERR_SSL_PROTOCOL_ERROR");
    assert.equal(shouldRetryWithHttp(tls, true), true);
    assert.equal(shouldRetryWithHttp(tls, false), false);
  });
});

describe("collectCookies", () => {
  test("keeps name=value pairs and drops attributes", () => {
    assert.equal(
      collectCookies("PHPSESSID=abc; path=/; HttpOnly, lang=ru; path=/"),
      "PHPSESSID=abc; lang=ru",
    );
  });

  test("does not split on commas inside an Expires date", () => {
    // "Expires=Wed, 21 Oct 2026 …" is the classic set-cookie splitting trap.
    assert.equal(
      collectCookies("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; path=/"),
      "a=1",
    );
  });

  test("handles an empty header", () => {
    assert.equal(collectCookies(""), "");
  });
});

describe("isAntibotHtml", () => {
  test("flags Qrator / WebKnight / DDoS-Guard challenges", () => {
    assert.equal(isAntibotHtml("<html><script>qrator_jsid=1</script></html>"), true);
    assert.equal(isAntibotHtml("<meta http-equiv='refresh' url=/qaptcha/>"), true);
    assert.equal(isAntibotHtml("<html>WebKnight Application Firewall</html>"), true);
    assert.equal(isAntibotHtml("<table id='tablcont'>дела</table>"), false);
  });
});

describe("HostGate", () => {
  /** Virtual clock so the politeness gap costs no real wall time. */
  function fakeClock() {
    let now = 0;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleeps,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      advance: (ms: number) => { now += ms; },
    };
  }

  test("serialises requests to one host", async () => {
    const clock = fakeClock();
    const gate = new HostGate(0, clock.now, clock.sleep);
    const log: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });

    const first = gate.run("okt--mor", async () => { log.push("a:start"); await blocked; log.push("a:end"); });
    const second = gate.run("okt--mor", async () => { log.push("b:start"); });

    await Promise.resolve();
    assert.deepEqual(log, ["a:start"], "second request must wait for the first");
    release();
    await Promise.all([first, second]);
    assert.deepEqual(log, ["a:start", "a:end", "b:start"]);
  });

  test("keeps a minimum gap between same-host requests", async () => {
    const clock = fakeClock();
    const gate = new HostGate(250, clock.now, clock.sleep);
    await gate.run("okt--mor", async () => {});
    await gate.run("okt--mor", async () => {});
    assert.deepEqual(clock.sleeps, [250]);
  });

  test("does not sleep when the host already idled long enough", async () => {
    const clock = fakeClock();
    const gate = new HostGate(250, clock.now, clock.sleep);
    await gate.run("okt--mor", async () => {});
    clock.advance(400);
    await gate.run("okt--mor", async () => {});
    assert.deepEqual(clock.sleeps, [], "no artificial delay after a natural pause");
  });

  test("different hosts run in parallel", async () => {
    const clock = fakeClock();
    const gate = new HostGate(250, clock.now, clock.sleep);
    const started: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });

    const a = gate.run("a--mor", async () => { started.push("a"); await blocked; });
    const b = gate.run("b--mor", async () => { started.push("b"); });

    await b;
    assert.deepEqual(started.sort(), ["a", "b"], "host b must not wait on host a");
    release();
    await a;
  });

  test("a rejected request does not poison the host queue", async () => {
    const clock = fakeClock();
    const gate = new HostGate(0, clock.now, clock.sleep);
    await assert.rejects(gate.run("okt--mor", async () => { throw new Error("503"); }), /503/);
    assert.equal(await gate.run("okt--mor", async () => "ok"), "ok");
  });

  test("releases host state once the queue drains", async () => {
    const clock = fakeClock();
    const gate = new HostGate(0, clock.now, clock.sleep);
    await gate.run("okt--mor", async () => {});
    // Chain entries must not accumulate across ~2269 court hosts.
    await new Promise((r) => setImmediate(r));
    assert.equal(gate.pendingHosts, 0);
  });
});

describe("SudrfHttpError", () => {
  test("carries the status, url and attempt count for the scheduler", () => {
    const e = new SudrfHttpError("HTTP 503", 503, "https://x.sudrf.ru/a", 4);
    assert.equal(e.name, "SudrfHttpError");
    assert.equal(e.status, 503);
    assert.equal(e.url, "https://x.sudrf.ru/a");
    assert.equal(e.attempts, 4);
    assert.ok(e instanceof Error);
  });
});
