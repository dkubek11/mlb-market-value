import base64
import io
from PIL import Image
import pytest

from headshots import get_headshot_data_uri, SILO_URL, FALLBACK_HEADSHOT_URL

def test_silo_cutout_returns_webp_data_uri_with_transparency():
    # 592450 = Aaron Judge, guaranteed to have official MLB silo
    data_uri = get_headshot_data_uri(592450)
    assert data_uri is not None
    assert data_uri.startswith("data:image/webp;base64,")
    
    # Verify image has alpha channel
    raw_b64 = data_uri.split(",", 1)[1]
    img_bytes = base64.b64decode(raw_b64)
    img = Image.open(io.BytesIO(img_bytes))
    assert img.format == "WEBP"
    assert img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

def test_missing_player_returns_none():
    data_uri = get_headshot_data_uri(999999999)
    assert data_uri is None

def test_fallback_headshot_used_when_silo_missing(monkeypatch, tmp_path):
    import requests
    import headshots

    # Force cache dir to tmp_path
    monkeypatch.setattr(headshots, "CACHE_DIR", tmp_path)
    
    # Mock requests to return 404 for silo and 200 with 1x1 jpeg for fallback
    real_get = requests.get
    def mock_get(url, timeout=15):
        if "silo" in url:
            class Mock404:
                status_code = 404
                content = b""
            return Mock404()
        else:
            class Mock200:
                status_code = 200
                content = b"\xff\xd8\xff\xe0\x00\x10JFIF"
            return Mock200()

    monkeypatch.setattr(requests, "get", mock_get)
    uri = headshots.get_headshot_data_uri(12345)
    assert uri is not None
    assert uri.startswith("data:image/jpeg;base64,")

