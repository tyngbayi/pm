import os

from openai import OpenAI

MODEL = "openai/gpt-oss-120b"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterConfigurationError(RuntimeError):
    pass


class OpenRouterResponseError(RuntimeError):
    pass


def ask_openrouter(message: str) -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise OpenRouterConfigurationError("OPENROUTER_API_KEY is not configured")

    with OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL) as client:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": message}],
        )

    if not completion.choices:
        raise OpenRouterResponseError("OpenRouter returned no response choices")

    content = completion.choices[0].message.content
    if not content or not content.strip():
        raise OpenRouterResponseError("OpenRouter returned an empty response")
    return content
