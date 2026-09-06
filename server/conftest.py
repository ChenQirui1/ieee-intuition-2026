"""Keep regression tests isolated from developer credentials and databases."""

import os

import pytest

os.environ["DATABASE_TYPE"] = "mock"
os.environ["ENABLE_TEST_ROUTES"] = "false"


@pytest.fixture(autouse=True)
def isolated_access_policy(monkeypatch):
    from api.security import _request_times

    monkeypatch.delenv("API_ACCESS_KEY", raising=False)
    monkeypatch.delenv("ALLOW_UNAUTHENTICATED_API", raising=False)
    monkeypatch.setenv("API_RATE_LIMIT_PER_MINUTE", "30")
    _request_times.clear()
    yield
    _request_times.clear()
