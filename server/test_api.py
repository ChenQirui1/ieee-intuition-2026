#!/usr/bin/env python3
"""
Test script to verify the /simplify endpoint works correctly.
Run this while the backend server is running.
"""

import requests
import json

API_BASE = "http://127.0.0.1:8000"

def test_simplify():
    """Test the /simplify endpoint with a real URL."""

    print("Testing /simplify endpoint...")
    print("-" * 50)

    # Test with a simple, reliable URL
    test_url = "https://example.com"

    payload = {
        "url": test_url,
        "mode": "easy_read",
        "language": "en",
        "session_id": "test_session_123",
        "force_regen": False
    }

    print(f"Request URL: {API_BASE}/simplify")
    print(f"Request payload: {json.dumps(payload, indent=2)}")
    print("-" * 50)

    try:
        response = requests.post(
            f"{API_BASE}/simplify",
            json=payload,
            timeout=60
        )

        print(f"Status Code: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print("-" * 50)

        if response.ok:
            data = response.json()
            print("✅ SUCCESS!")
            print(f"Page ID: {data.get('page_id')}")
            print(f"Language: {data.get('language')}")
            print(f"Model: {data.get('model')}")

            easy_read = data.get('outputs', {}).get('easy_read')
            if easy_read:
                print(f"\nKey Points ({len(easy_read.get('key_points', []))}):")
                for i, point in enumerate(easy_read.get('key_points', [])[:3], 1):
                    print(f"  {i}. {point}")

            return True
        else:
            print("❌ FAILED!")
            print(f"Error: {response.text}")
            return False

    except requests.exceptions.ConnectionError:
        print("❌ CONNECTION ERROR!")
        print("Make sure the backend server is running:")
        print("  cd server")
        print("  .venv\\Scripts\\activate")
        print("  uvicorn main:app --reload --host 127.0.0.1 --port 8000")
        return False

    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def test_connection():
    """Test if backend is reachable."""
    print("\nTesting backend connection...")
    print("-" * 50)

    try:
        response = requests.get(f"{API_BASE}/openai-test", timeout=5)
        if response.ok:
            print("✅ Backend is reachable!")
            data = response.json()
            print(f"Model: {data.get('model')}")
            return True
        else:
            print(f"❌ Backend returned error: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Cannot reach backend: {e}")
        return False

if __name__ == "__main__":
    print("=" * 50)
    print("Backend API Test Script")
    print("=" * 50)

    # Test connection first
    if not test_connection():
        print("\n⚠️  Backend is not running or not reachable.")
        exit(1)

    print()

    # Test simplify endpoint
    if test_simplify():
        print("\n✅ All tests passed!")
    else:
        print("\n❌ Tests failed. Check the error messages above.")
