"""LLM fleet client (OpenAI-compatible). Generates email content variants from a brief + a
representative trait profile. Sync + dependency-light so the worker is easy to test."""
import json
import os
import re
import time

import httpx


class FlotClient:
    def __init__(self, base_url=None, model=None, retry_limit=5):
        self.base_url = base_url or os.getenv("FLOT_BASE_URL", "http://127.0.0.1:3264/api/v1")
        self.model = model or os.getenv("FLOT_MODEL", "qwen3.7-max")
        self.retry_limit = retry_limit

    def generate_variants(self, brief, traits, num_variants):
        """Returns a list of {subject, body} dicts (length <= num_variants)."""
        prompt = (
            "Ты — B2B email-маркетолог промышленного магазина. "
            f"Бриф кампании: {brief}. "
            f"Профиль сегмента (репрезентатив): {json.dumps(traits, ensure_ascii=False)}. "
            f"Сгенерируй {num_variants} вариант(ов) ПЕРСОНАЛЬНОГО письма под этот профиль. "
            'Верни СТРОГО JSON-массив без markdown: '
            '[{"subject":"тема 20-90 символов","body":"<p>HTML-тело 2-3 предложения</p>"}].'
        )
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 1200,
            "stream": False,
        }
        last_err = None
        for attempt in range(self.retry_limit):
            try:
                resp = httpx.post(f"{self.base_url}/chat/completions", json=payload, timeout=120)
                if resp.status_code == 429:
                    time.sleep(2 ** attempt)
                    continue
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                return self._parse(content, num_variants)
            except Exception as exc:  # noqa: BLE001 — retry on any transient failure
                last_err = exc
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"Flot generation failed after {self.retry_limit} attempts: {last_err}")

    @staticmethod
    def _parse(content, num_variants):
        def norm(x):
            return {"subject": str(x.get("subject", "")), "body": str(x.get("body", ""))}

        arr = re.search(r"\[.*\]", content, re.DOTALL)
        if arr:
            try:
                items = json.loads(arr.group(0))
                if isinstance(items, list):
                    return [norm(x) for x in items if isinstance(x, dict)][:num_variants]
            except json.JSONDecodeError:
                pass
        obj = re.search(r"\{.*\}", content, re.DOTALL)
        if obj:
            try:
                return [norm(json.loads(obj.group(0)))]
            except json.JSONDecodeError:
                pass
        return []
