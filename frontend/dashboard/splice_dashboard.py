"""Bakes dashboard_data.json + fonts + texture into dashboard_template.html,
producing a publishable single-file dashboard. Run build_dashboard.py first.
"""

import pathlib

HERE = pathlib.Path(__file__).parent

template = (HERE / "dashboard_template.html").read_text(encoding="utf-8")
data_json = (HERE / "dashboard_data.json").read_text(encoding="utf-8")
rye_b64 = (HERE / "rye.b64").read_text(encoding="utf-8").strip()
courier_reg_b64 = (HERE / "courier-regular.b64").read_text(encoding="utf-8").strip()
courier_bold_b64 = (HERE / "courier-bold.b64").read_text(encoding="utf-8").strip()
noise_b64 = (HERE / "noise.b64").read_text(encoding="utf-8").strip()

out = template
out = out.replace("__DATA_JSON__", data_json)
out = out.replace("__RYE_FONT__", rye_b64)
out = out.replace("__COURIER_REGULAR_FONT__", courier_reg_b64)
out = out.replace("__COURIER_BOLD_FONT__", courier_bold_b64)
out = out.replace("__NOISE_TEXTURE__", noise_b64)

(HERE / "dashboard_final.html").write_text(out, encoding="utf-8")

remaining = [p for p in ["__DATA_JSON__", "__RYE_FONT__", "__COURIER_REGULAR_FONT__", "__COURIER_BOLD_FONT__", "__NOISE_TEXTURE__"] if p in out]
print("output size:", len(out), "chars")
print("leftover placeholders:", remaining)
print("wrote", HERE / "dashboard_final.html")
