import pytest
import os
import sys

# Add project root and backend dir to sys.path
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
backend_dir = os.path.join(root_dir, "backend")
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
import services.db_service as s_db
from backend.server import app

@pytest.fixture(autouse=True)
def setup_test_db(monkeypatch, tmp_path):
    """Use an isolated temporary SQLite database for tests."""
    test_db_path = str(tmp_path / "test_oxyzen.db")
    
    if "backend.services.db_service" in sys.modules:
        monkeypatch.setattr(sys.modules["backend.services.db_service"], "DB_PATH", test_db_path)
    if "services.db_service" in sys.modules:
        monkeypatch.setattr(sys.modules["services.db_service"], "DB_PATH", test_db_path)
    
    s_db.init_db()
    yield test_db_path

    # Clean teardown
    try:
        conn = s_db.get_db()
        for tbl in ["likes", "playlists", "playlist_tracks", "history", "preferences"]:
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
        conn.close()
    except Exception:
        pass

@pytest.fixture
def client():
    """FastAPI TestClient instance."""
    with TestClient(app) as c:
        yield c
