from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "qa" / "recruiter-showcase"
TARGET_SIZE = (840, 525)

SHOWCASE_MANIFEST = [
    {
        "slug": "login",
        "title": "Login",
        "sources": ["qa/manual-sweep/login-debug.png"],
    },
    {
        "slug": "dashboard",
        "title": "Dashboard",
        "sources": ["qa/manual-sweep/dashboard-light.png", "qa/manual-sweep/dashboard-dark.png"],
    },
    {
        "slug": "assistant",
        "title": "Assistant",
        "sources": [
            "qa/manual-sweep/assistant-light.png",
            "qa/evidence/screenshots/assistant-open.png",
            "qa/evidence/screenshots/assistant-response.png",
            "qa/manual-sweep/assistant-dark.png",
        ],
    },
    {
        "slug": "inventory",
        "title": "Inventory",
        "sources": ["qa/manual-sweep/inventory-light.png", "qa/manual-sweep/inventory-dark.png"],
    },
    {
        "slug": "terminal",
        "title": "Terminal",
        "sources": ["qa/manual-sweep/terminal-light.png", "qa/manual-sweep/terminal-dark.png"],
    },
    {
        "slug": "orders",
        "title": "Orders",
        "sources": ["qa/manual-sweep/orders-light.png", "qa/manual-sweep/orders-dark.png"],
    },
    {
        "slug": "refunds",
        "title": "Refunds",
        "sources": [
            "qa/manual-sweep/refunds-light.png",
            "qa/evidence/screenshots/refund-desk-ready.png",
            "qa/manual-sweep/refunds-dark.png",
        ],
    },
    {
        "slug": "reports",
        "title": "Reports",
        "sources": ["qa/manual-sweep/reports-light.png", "qa/manual-sweep/reports-dark.png"],
    },
    {
        "slug": "customers",
        "title": "Customers",
        "sources": ["qa/manual-sweep/customers-light.png", "qa/manual-sweep/customers-dark.png"],
    },
    {
        "slug": "customer-detail",
        "title": "Customer Detail",
        "sources": [
            "qa/manual-sweep/customer-detail-light.png",
            "qa/evidence/screenshots/customer-profile-dark.png",
            "qa/manual-sweep/customer-detail-dark.png",
        ],
    },
    {
        "slug": "suppliers",
        "title": "Suppliers",
        "sources": ["qa/manual-sweep/suppliers-light.png", "qa/manual-sweep/suppliers-dark.png"],
    },
    {
        "slug": "supplier-detail",
        "title": "Supplier Detail",
        "sources": ["qa/manual-sweep/supplier-detail-light.png", "qa/manual-sweep/supplier-detail-dark.png"],
    },
    {
        "slug": "users",
        "title": "Users",
        "sources": ["qa/manual-sweep/users-light.png", "qa/manual-sweep/users-dark.png"],
    },
    {
        "slug": "user-create",
        "title": "Create Staff",
        "sources": ["qa/evidence/screenshots/users-create-staff.png"],
    },
    {
        "slug": "user-detail",
        "title": "User Detail",
        "sources": [
            "qa/manual-sweep/user-detail-light.png",
            "qa/evidence/screenshots/users-staff-security.png",
            "qa/manual-sweep/user-detail-dark.png",
        ],
    },
    {
        "slug": "settings",
        "title": "Settings",
        "sources": [
            "qa/manual-sweep/settings-light.png",
            "qa/evidence/screenshots/settings-dark-mode.png",
            "qa/manual-sweep/settings-dark.png",
        ],
    },
]


def load_font(size: int) -> ImageFont.ImageFont:
    for candidate in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        font_path = Path(candidate)
        if font_path.exists():
            return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


TITLE_FONT = load_font(28)
BADGE_FONT = load_font(17)


def fit_frame(image: Image.Image) -> Image.Image:
    return ImageOps.fit(image.convert("RGB"), TARGET_SIZE, method=Image.Resampling.LANCZOS)


def apply_zoom(image: Image.Image, progress: float) -> Image.Image:
    width, height = image.size
    scale = 1 + (0.06 * progress)
    scaled = image.resize(
        (round(width * scale), round(height * scale)),
        resample=Image.Resampling.LANCZOS,
    )
    left = max(0, (scaled.width - width) // 2)
    top = max(0, round((scaled.height - height) * 0.12))
    return scaled.crop((left, top, left + width, top + height))


def annotate(image: Image.Image, title: str) -> Image.Image:
    frame = image.copy()
    draw = ImageDraw.Draw(frame, "RGBA")
    draw.rounded_rectangle((24, 20, 190, 60), radius=18, fill=(10, 14, 28, 210))
    draw.text((40, 31), "AfroSpice", font=BADGE_FONT, fill=(245, 247, 255))
    draw.rounded_rectangle((24, 74, 400, 126), radius=20, fill=(10, 14, 28, 196))
    draw.text((40, 88), title, font=TITLE_FONT, fill=(255, 255, 255))
    return frame


def build_frames(sources: list[Path], title: str) -> list[Image.Image]:
    prepared = [fit_frame(Image.open(source)) for source in sources]
    frames: list[Image.Image] = []

    for index, image in enumerate(prepared):
        for step in range(5):
            frame = apply_zoom(image, step / 4 if 4 else 0)
            frames.append(annotate(frame, title))

        if index >= len(prepared) - 1:
            continue

        next_image = prepared[index + 1]
        for step in range(1, 5):
            blended = Image.blend(image, next_image, step / 5)
            frames.append(annotate(blended, title))

    return [frame.quantize(colors=96, method=Image.Quantize.MEDIANCUT) for frame in frames]


def build_showcase_gif(entry: dict[str, object]) -> dict[str, object]:
    slug = str(entry["slug"])
    title = str(entry["title"])
    source_paths = [ROOT / str(source) for source in entry["sources"]]

    missing = [str(path.relative_to(ROOT)) for path in source_paths if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing screenshot assets for {slug}: {', '.join(missing)}")

    frames = build_frames(source_paths, title)
    output_path = OUTPUT_DIR / f"{slug}.gif"
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=180,
        loop=0,
        optimize=True,
        disposal=2,
    )

    return {
        "slug": slug,
        "title": title,
        "gif": str(output_path.relative_to(ROOT)).replace("\\", "/"),
        "sources": [str(path.relative_to(ROOT)).replace("\\", "/") for path in source_paths],
    }


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for gif_file in OUTPUT_DIR.glob("*.gif"):
        gif_file.unlink()
    frames_dir = OUTPUT_DIR / "frames"
    if frames_dir.exists():
        for child in frames_dir.iterdir():
            if child.is_file():
                child.unlink()
        frames_dir.rmdir()

    summary = {"generated_from": "existing QA screenshots", "routes": []}
    for entry in SHOWCASE_MANIFEST:
        summary["routes"].append(build_showcase_gif(entry))

    summary_path = OUTPUT_DIR / "summary.json"
    summary_path.write_text(f"{json.dumps(summary, indent=2)}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
