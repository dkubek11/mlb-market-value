from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
HEAD_HTML_PATH = ROOT_DIR / "frontend" / "dashboard" / "parts" / "head.html"
STYLES_CSS_PATH = ROOT_DIR / "frontend" / "dashboard" / "parts" / "styles.css"

def test_variant_1_head_fonts_and_theme():
    head_content = HEAD_HTML_PATH.read_text(encoding="utf-8")
    assert "Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400" in head_content
    assert "Inter:wght@400;500;600;700" in head_content
    assert "Space+Mono:wght@400;700" in head_content
    assert '<meta name="theme-color" content="#121316"' in head_content

def test_variant_1_css_tokens():
    css_content = STYLES_CSS_PATH.read_text(encoding="utf-8")
    assert "--font-serif: 'Newsreader'" in css_content
    assert "--bg-dark: #121316;" in css_content
    assert "--bg-sidebar: #17181c;" in css_content
    assert "--bg-card: #1a1b1f;" in css_content
    assert "--border-color: #2e3036;" in css_content
    assert "--text-main: #f4efe6;" in css_content
    assert "--text-sub: #c5bfb2;" in css_content
    assert "--text-muted: #857f72;" in css_content
    assert "--accent-gold: #c99b42;" in css_content
    assert "--accent-green: #5a9e6f;" in css_content
    assert "--accent-red: #b85d53;" in css_content

def test_variant_1_gradient_and_surface_colors():
    css_content = STYLES_CSS_PATH.read_text(encoding="utf-8")
    # Verify removal of saturated blue radial gradients in root
    assert "radial-gradient(150% 120% at 15% 24%" not in css_content
    # Verify matte dark background on html
    assert "html {" in css_content and "#121316" in css_content
    # Verify stadium fade to matte dark charcoal
    assert "#0a1018" not in css_content

def test_variant_1_serif_headlines():
    css_content = STYLES_CSS_PATH.read_text(encoding="utf-8")
    assert ".brand-title {" in css_content
    # Confirm serif is applied to headlines
    assert "font-family: var(--font-serif);" in css_content

def test_variant_1_desaturated_badges_and_flat_borders():
    css_content = STYLES_CSS_PATH.read_text(encoding="utf-8")
    # Verify neon green #00e676 and neon red #ff4d4d are not hardcoded in rank/badge rules
    assert "rgba(0, 230, 118" not in css_content
    assert "rgba(255, 77, 77" not in css_content
    assert "rgba(79, 172, 254" not in css_content

def test_variant_1_ledger_table_styling():
    css_content = STYLES_CSS_PATH.read_text(encoding="utf-8")
    assert ".table-scroll th" in css_content
    assert "rgba(26, 27, 31, 0.98)" in css_content
    assert "tabular-nums" in css_content

def test_assembled_dashboard_has_editorial_tokens():
    """Verify that backend assembly includes the new styles and fonts."""
    from app.main import _assemble_template
    html = _assemble_template()
    assert "Newsreader:ital,opsz,wght" in html
    assert "--font-serif: 'Newsreader'" in html
    assert "--bg-dark: #121316;" in html
    assert "--text-main: #f4efe6;" in html
    assert "radial-gradient(150% 120% at 15% 24%" not in html

def test_variant_1_floating_cutout_styles():
    css_content = STYLES_CSS_PATH.read_text(encoding="utf-8")
    assert ".card-hero-avatar img" in css_content
    assert "drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45))" in css_content



