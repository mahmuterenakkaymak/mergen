"""Small, repeatable speed check for a local Strata server.

Runs the same requests every time so two configurations (e.g. 128K vs 256K context)
can be compared. Uses only the standard library.

Usage:  python bench_strata.py [--runs 3] [--label 128k] [--out results.json]
"""
import argparse
import json
import statistics
import time
import urllib.request
import uuid

# --- config -----------------------------------------------------------------
BASE_URL = "http://127.0.0.1:8080/v1/chat/completions"
SHORT_PROMPT = "Write about 400 words on the history of Istanbul's Galata Tower."
SHORT_MAX_TOKENS = 512
LONG_PROMPT_LINES = 1600          # ~16K tokens of filler text
LONG_MAX_TOKENS = 128
TIMEOUT_S = 900
# -----------------------------------------------------------------------------


def chat(prompt: str, max_tokens: int) -> dict:
    body = json.dumps({
        "model": "strata",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0,
        "reasoning_effort": "none",
    }).encode()
    req = urllib.request.Request(BASE_URL, data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        data = json.load(r)
    t = data.get("timings", {})
    return {
        "wall_s": round(time.time() - t0, 2),
        "prompt_tokens": data["usage"]["prompt_tokens"],
        "cached_tokens": t.get("cache_n", 0),
        "prefill_tps": t.get("prompt_per_second"),
        "output_tokens": data["usage"]["completion_tokens"],
        "decode_tps": t.get("predicted_per_second"),
    }


def long_prompt() -> str:
    # A random nonce first, so the conversation cache cannot reuse an earlier run.
    lines = [f"Run {uuid.uuid4()}. Read the inventory log below, then answer the question at the end."]
    for i in range(LONG_PROMPT_LINES):
        lines.append(f"Line {i}: warehouse A{i % 37} moved {i * 7 % 101} units of item SKU-{i:05d} on day {i % 28 + 1}.")
    lines.append("Question: which SKU appears on line 1234? Answer with the SKU only.")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--label", default="run")
    ap.add_argument("--out")
    a = ap.parse_args()

    chat("Say OK.", 4)  # warm-up
    short = [chat(SHORT_PROMPT, SHORT_MAX_TOKENS) for _ in range(a.runs)]
    long_ = [chat(long_prompt(), LONG_MAX_TOKENS) for _ in range(a.runs)]

    med = lambda rows, k: round(statistics.median(r[k] for r in rows), 1)
    summary = {
        "label": a.label,
        "short_decode_tps": med(short, "decode_tps"),
        "long_prompt_tokens": long_[0]["prompt_tokens"],
        "long_prefill_tps": med(long_, "prefill_tps"),
        "long_decode_tps": med(long_, "decode_tps"),
        "short_runs": short,
        "long_runs": long_,
    }
    print(json.dumps({k: v for k, v in summary.items() if not k.endswith("_runs")}, indent=1))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=1)


if __name__ == "__main__":
    main()
