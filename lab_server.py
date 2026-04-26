#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8000
ANU_ENDPOINT = "https://qrng.anu.edu.au/API/jsonI.php"
QCI_BASE_URL = "https://api.qci-prod.com"
PROVIDER_SPECS = {
    "anu": {
        "label": "ANU QRNG",
        "requires_token": False,
        "supported_bit_widths": [8, 16],
        "endpoint": ANU_ENDPOINT,
    },
    "qci": {
        "label": "QCI QRNG",
        "requires_token": True,
        "supported_bit_widths": [8, 16],
        "endpoint": f"{QCI_BASE_URL}/qrng/random_numbers",
    },
    "system": {
        "label": "System Crypto Fallback",
        "requires_token": False,
        "supported_bit_widths": [8, 16, 32],
        "endpoint": "local",
    },
}


@dataclass
class ProviderResult:
    provider: str
    source: str
    data: list[int]
    metadata: Dict[str, Any]


def json_response(handler: "LabRequestHandler", status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def parse_int(value: str | None, default: int, minimum: int, maximum: int) -> int:
    if value is None:
        return default
    parsed = int(value)
    return max(minimum, min(maximum, parsed))


def quantized_random(bit_width: int, count: int) -> list[int]:
    upper = (1 << bit_width) - 1
    return [secrets.randbelow(upper + 1) for _ in range(count)]


def fetch_json(url: str, *, method: str = "GET", headers: Dict[str, str] | None = None, body: bytes | None = None) -> Dict[str, Any]:
    request = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_anu(count: int, bit_width: int) -> ProviderResult:
    if bit_width not in {8, 16}:
        raise ValueError("ANU supports only 8-bit and 16-bit unsigned integer output.")
    query = urllib.parse.urlencode({"length": count, "type": f"uint{bit_width}"})
    payload = fetch_json(f"{ANU_ENDPOINT}?{query}")
    if not payload.get("success"):
        raise RuntimeError(payload.get("message", "ANU QRNG request failed."))
    data = payload.get("data", [])
    if not isinstance(data, list):
        raise RuntimeError("ANU QRNG returned malformed data.")
    return ProviderResult(
        provider="anu",
        source="anu",
        data=[int(item) for item in data],
        metadata={
            "requested_length": count,
            "requested_type": f"uint{bit_width}",
            "success": True,
        },
    )


def fetch_qci(count: int, bit_width: int) -> ProviderResult:
    api_token = os.environ.get("QCI_API_TOKEN", "").strip()
    if not api_token:
        raise RuntimeError("QCI_API_TOKEN is not set.")

    auth_payload = fetch_json(
        f"{QCI_BASE_URL}/auth/v1/access-tokens",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body=json.dumps({"refresh_token": api_token}).encode("utf-8"),
    )
    access_token = auth_payload.get("access_token")
    if not access_token:
        raise RuntimeError("QCI authentication did not return an access token.")

    request_payload = {
        "distribution": "uniform_discrete",
        "output_type": "decimal",
        "n_samples": count,
        "n_bits": bit_width,
    }
    payload = fetch_json(
        f"{QCI_BASE_URL}/qrng/random_numbers",
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body=json.dumps(request_payload).encode("utf-8"),
    )

    data = payload.get("data") or payload.get("numbers") or payload.get("random_numbers")
    if not isinstance(data, list):
        raise RuntimeError("QCI QRNG returned malformed data.")

    return ProviderResult(
        provider="qci",
        source="qci",
        data=[int(item) for item in data],
        metadata={
            "requested_length": count,
            "requested_size": bit_width,
            "authenticated": True,
        },
    )


def fetch_system(count: int, bit_width: int) -> ProviderResult:
    return ProviderResult(
        provider="system",
        source="system",
        data=quantized_random(bit_width, count),
        metadata={
            "requested_length": count,
            "requested_size": bit_width,
            "note": "Cryptographic fallback from Python secrets; not quantum entropy.",
        },
    )


def resolve_qrng(provider: str, count: int, bit_width: int, fallback: str) -> ProviderResult:
    provider = provider.lower()
    fallback = fallback.lower()
    fetchers = {
        "anu": fetch_anu,
        "qci": fetch_qci,
        "system": fetch_system,
    }
    if provider not in fetchers:
        raise ValueError(f"Unsupported provider '{provider}'.")
    if fallback not in fetchers:
        raise ValueError(f"Unsupported fallback '{fallback}'.")

    try:
        return fetchers[provider](count, bit_width)
    except Exception as error:
        if fallback == provider:
            raise
        fallback_result = fetchers[fallback](count, bit_width)
        fallback_result.metadata["fallback_reason"] = str(error)
        fallback_result.metadata["requested_provider"] = provider
        return fallback_result


def validate_provider_request(provider: str, bit_width: int, role: str) -> None:
    spec = PROVIDER_SPECS.get(provider)
    if spec is None:
        raise ValueError(f"Unsupported {role} '{provider}'.")
    if bit_width not in spec["supported_bit_widths"]:
        supported = ", ".join(str(width) for width in spec["supported_bit_widths"])
        raise ValueError(f"{spec['label']} does not support {bit_width}-bit output. Supported widths: {supported}.")


def provider_registry() -> Dict[str, Any]:
    providers = []
    for provider_id, spec in PROVIDER_SPECS.items():
        provider = {"id": provider_id, **spec}
        if provider_id == "qci":
            provider["configured"] = bool(os.environ.get("QCI_API_TOKEN", "").strip())
        providers.append(provider)
    return {
        "providers": providers,
        "default_provider": "anu",
        "default_fallback": "system",
    }


class LabRequestHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urllib.parse.urlparse(path)
        relative = parsed.path.lstrip("/") or "index.html"
        candidate = (ROOT / relative).resolve()
        try:
            candidate.relative_to(ROOT)
        except ValueError:
            return str(ROOT)
        return str(candidate)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/qrng/providers":
            json_response(self, HTTPStatus.OK, provider_registry())
            return

        if parsed.path == "/api/qrng/health":
            json_response(
                self,
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "time": time.time(),
                    "providers": provider_registry()["providers"],
                },
            )
            return

        if parsed.path == "/api/qrng":
            self.handle_qrng_request(parsed.query)
            return

        super().do_GET()

    def handle_qrng_request(self, query_string: str) -> None:
        params = urllib.parse.parse_qs(query_string)
        try:
            provider = params.get("provider", ["anu"])[0].lower()
            fallback = params.get("fallback", ["system"])[0].lower()
            count = parse_int(params.get("count", [None])[0], default=16, minimum=1, maximum=1024)
            bit_width = parse_int(params.get("bits", [None])[0], default=16, minimum=8, maximum=32)
            validate_provider_request(provider, bit_width, "provider")
            validate_provider_request(fallback, bit_width, "fallback")
            result = resolve_qrng(provider, count, bit_width, fallback)
        except ValueError as error:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except urllib.error.URLError as error:
            json_response(
                self,
                HTTPStatus.BAD_GATEWAY,
                {
                    "error": "QRNG upstream request failed.",
                    "detail": str(error),
                },
            )
            return
        except Exception as error:
            json_response(
                self,
                HTTPStatus.BAD_GATEWAY,
                {
                    "error": "QRNG request failed.",
                    "detail": str(error),
                },
            )
            return

        payload = {
            "provider": result.provider,
            "source": result.source,
            "count": len(result.data),
            "bit_width": bit_width,
            "data": result.data,
            "metadata": result.metadata,
        }
        json_response(self, HTTPStatus.OK, payload)

    def log_message(self, format: str, *args: Any) -> None:
        super().log_message(format, *args)


def main() -> None:
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer(("127.0.0.1", port), LabRequestHandler)
    print(f"Quantum Sound Lab serving {ROOT} at http://127.0.0.1:{port}/")
    print("QRNG API ready at /api/qrng and /api/qrng/providers")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
