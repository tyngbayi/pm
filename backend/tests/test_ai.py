from unittest.mock import MagicMock

import pytest

import ai


def test_ask_openrouter_uses_configured_model_and_message(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat.completions.create.return_value.choices = [
        MagicMock(message=MagicMock(content="4"))
    ]
    openai_client = MagicMock(return_value=client)
    monkeypatch.setattr(ai, "OpenAI", openai_client)

    response = ai.ask_openrouter("What is 2+2?")

    assert response == "4"
    openai_client.assert_called_once_with(
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
    )
    client.chat.completions.create.assert_called_once_with(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": "What is 2+2?"}],
    )


def test_ask_openrouter_requires_an_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(ai.OpenRouterConfigurationError):
        ai.ask_openrouter("What is 2+2?")


def test_chat_with_openrouter_uses_board_context_and_json_mode(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat.completions.create.return_value.choices = [
        MagicMock(
            message=MagicMock(
                content='{"message":"Hello","board_update":null}'
            )
        )
    ]
    monkeypatch.setattr(ai, "OpenAI", MagicMock(return_value=client))
    messages = [{"role": "user", "content": "Tell me about the backlog."}]
    board = {"columns": [], "cards": {}}

    response = ai.chat_with_openrouter(messages, board)

    assert response == '{"message":"Hello","board_update":null}'
    call = client.chat.completions.create.call_args.kwargs
    assert call["model"] == "openai/gpt-oss-120b"
    assert call["messages"][1:] == messages
    assert '{"columns": [], "cards": {}}' in call["messages"][0]["content"]
    assert call["response_format"] == {"type": "json_object"}
