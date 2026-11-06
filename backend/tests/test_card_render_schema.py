"""Pytest runner executing the Node.js frontend DOM render verification test.

Ensures that the real frontend player card rendering functions produce 100% valid
DOM markup for all top 50 highest AAV players across both 2026 and 2030.
"""

from pathlib import Path
import subprocess
import pytest


def test_top_50_player_cards_frontend_dom_render():
    """Execute verify_player_cards_render.js and assert flawless output."""
    script_path = Path(__file__).resolve().parent / "verify_player_cards_render.js"
    assert script_path.exists(), f"Missing verification script: {script_path}"

    result = subprocess.run(
        ["node", str(script_path)],
        capture_output=True,
        text=True,
        timeout=30,
    )

    # Print stdout for test logs if verbose
    print("\nNode Render Verification Output:")
    print(result.stdout)

    if result.returncode != 0:
        print("\nNode Render Verification Error Output:")
        print(result.stderr)

    assert result.returncode == 0, f"Render test failed with exit code {result.returncode}:\n{result.stderr}"
    assert "All 50 players passed 2026 render integrity checks (50/50)" in result.stdout
    assert "All 50 players passed 2030 time-invariance render checks (50/50)" in result.stdout
    assert "All render integrity verifications completed successfully!" in result.stdout

