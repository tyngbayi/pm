import json
import os

from openai import OpenAI

MODEL = "openai/gpt-oss-120b"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MAX_HISTORY_MESSAGES = 20
# Large enough for the model to echo back a full board update.
MAX_COMPLETION_TOKENS = 4096


class OpenRouterConfigurationError(RuntimeError):
    pass


class OpenRouterResponseError(RuntimeError):
    pass


def _create_openrouter_client() -> OpenAI:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise OpenRouterConfigurationError("OPENROUTER_API_KEY is not configured")
    return OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)


def ask_openrouter(message: str) -> str:
    with _create_openrouter_client() as client:
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


def chat_with_openrouter(
    messages: list[dict[str, str]],
    board: dict[str, object],
) -> str:
    system_prompt = (
        "You are a project-management assistant. Return a JSON object with a "
        "non-empty string field `message` and a `board_update` field that is "
        "either null or a complete BoardData object. Set board_update to null "
        "for general questions. For requested card changes, return the complete "
        "updated board, preserving the existing column IDs and order and "
        "preserving all cards not explicitly changed. The board data is: "
        f"{json.dumps(board, ensure_ascii=False)}"
    )
    request_messages = [
        {"role": "system", "content": system_prompt},
        *messages[-MAX_HISTORY_MESSAGES:],
    ]

    with _create_openrouter_client() as client:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=request_messages,
            response_format={"type": "json_object"},
            max_tokens=MAX_COMPLETION_TOKENS,
        )

    if not completion.choices:
        raise OpenRouterResponseError("OpenRouter returned no response choices")

    content = completion.choices[0].message.content
    if not content:
        raise OpenRouterResponseError("OpenRouter returned no structured response")
    return content
