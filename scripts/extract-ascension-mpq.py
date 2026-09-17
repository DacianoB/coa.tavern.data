import argparse
import datetime
import io
import json
import os
import pathlib
import re
import subprocess
import sys


def ensure_mpyq():
    try:
        import mpyq  # type: ignore

        return mpyq
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "mpyq"])
        import mpyq  # type: ignore

        return mpyq


def ensure_pillow():
    try:
        from PIL import Image  # type: ignore

        return Image
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "Pillow"])
        from PIL import Image  # type: ignore

        return Image


def natural_key(value: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


def archive_priority(path: pathlib.Path, locale: str):
    name = path.name.lower()
    parent = path.parent.name.lower()
    is_locale = parent == locale.lower()

    if not name.startswith("patch"):
        return (1 if is_locale else 0, natural_key(name))

    standard_root = {"patch.mpq", "patch-2.mpq", "patch-3.mpq"}
    if not is_locale and name in standard_root:
        return (2, natural_key(name))

    if is_locale:
        return (3, natural_key(name))

    return (4, natural_key(name))


def archive_paths(data_dir: pathlib.Path, locale: str):
    paths: dict[str, pathlib.Path] = {}
    for directory in [data_dir, data_dir / locale]:
        if not directory.exists():
            continue

        for pattern in ("*.MPQ", "*.mpq"):
            for path in directory.glob(pattern):
                paths[str(path).lower()] = path

    return sorted(paths.values(), key=lambda p: archive_priority(p, locale))


def normalize_mpq_name(name):
    if isinstance(name, bytes):
        name = name.decode("utf-8", "ignore")

    return name.replace("/", "\\").lower()


def normalize_icon_name(name: str):
    normalized = name.strip().lstrip("\ufeff").replace("\\", "/").split("/")[-1].lower()
    return re.sub(r"\.(blp|jpg|jpeg|png|webp)$", "", normalized)


def icon_requests(icon_list_file: str | None):
    if not icon_list_file:
        return {}

    names = {}
    with open(icon_list_file, "r", encoding="utf-8") as file:
        for line in file:
            name = normalize_icon_name(line)
            if not name:
                continue

            names[f"interface\\icons\\{name}.blp"] = name

    return names


def existing_icon_names(icons_out_dir: str | None):
    if not icons_out_dir:
        return set()

    out_dir = pathlib.Path(icons_out_dir)
    if not out_dir.exists():
        return set()

    return {
        normalize_icon_name(path.name)
        for path in out_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    }


def write_icon(image_module, data: bytes, out_path: pathlib.Path):
    with image_module.open(io.BytesIO(data)) as image:
        converted = image.convert("RGBA")
        background = image_module.new("RGB", converted.size, (0, 0, 0))
        background.paste(converted, mask=converted.getchannel("A"))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        background.save(out_path, "JPEG", quality=92, optimize=True)


def normalize_alias(value: str):
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def map_slug(value: str):
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "unknown-map"


def minimap_tile_info(mpq_name: str):
    match = re.match(
        r"^world\\minimaps\\([^\\]+)\\([^\\]+)_(\d+)_(\d+)\.blp$",
        mpq_name,
        re.IGNORECASE,
    )
    if not match:
        return None

    map_key, _file_base, tile_x, tile_y = match.groups()
    return map_key, int(tile_x), int(tile_y), set()


def worldmap_tile_info(mpq_name: str):
    match = re.match(
        r"^interface\\worldmap\\([^\\]+)\\([^\\]+)\.blp$",
        mpq_name,
        re.IGNORECASE,
    )
    if not match:
        return None

    directory, file_base = match.groups()
    tile_match = re.match(r"^(.+?)_?(\d{1,2})$", file_base)
    if not tile_match:
        return None

    map_key, tile_number = tile_match.groups()
    tile_index = int(tile_number)
    if tile_index < 1 or tile_index > 12:
        return None

    tile_x = (tile_index - 1) % 4
    tile_y = (tile_index - 1) // 4
    return map_key, tile_x, tile_y, {directory if directory == map_key else map_key}


def collect_minimap_tiles(data_dir: pathlib.Path, locale: str, map_filter: str | None):
    requested_alias = normalize_alias(map_filter) if map_filter else None
    tiles: dict[str, dict[tuple[int, int], tuple[pathlib.Path, str]]] = {}
    sources: dict[str, set[str]] = {}
    aliases_by_map: dict[str, set[str]] = {}
    archives_seen = 0
    named_files_seen = 0

    for archive_path in archive_paths(data_dir, locale):
        try:
            archive = mpyq.MPQArchive(str(archive_path))  # type: ignore[name-defined]
        except Exception as error:
            print(f"skip {archive_path.name}: {error}", file=sys.stderr)
            continue

        archives_seen += 1
        names = {normalize_mpq_name(name): name for name in archive.files}
        named_files_seen += len(names)
        for mpq_name, real_name in names.items():
            tile = minimap_tile_info(mpq_name) or worldmap_tile_info(mpq_name)
            if tile is None:
                continue

            map_key, tile_x, tile_y, tile_aliases = tile
            aliases = {map_key, *tile_aliases}
            if requested_alias and not any(
                requested_alias in normalize_alias(alias) for alias in aliases
            ):
                continue

            tiles.setdefault(map_key, {})[(tile_x, tile_y)] = (archive_path, real_name)
            sources.setdefault(map_key, set()).add(archive_path.name)
            aliases_by_map.setdefault(map_key, set()).update(aliases)

    return tiles, sources, aliases_by_map, archives_seen, named_files_seen


def save_stitched_map(
    image_module,
    map_key: str,
    tile_refs: dict[tuple[int, int], tuple[pathlib.Path, str]],
    sources: set[str],
    aliases: set[str],
    maps_out_dir: pathlib.Path,
    image_format: str,
    archive_cache: dict[pathlib.Path, object],
):
    if not tile_refs:
        return None

    images = []
    for (tile_x, tile_y), (archive_path, real_name) in sorted(tile_refs.items()):
        try:
            archive = archive_cache.get(archive_path)
            if archive is None:
                archive = mpyq.MPQArchive(str(archive_path))  # type: ignore[name-defined]
                archive_cache[archive_path] = archive
            data = archive.read_file(real_name)
            image = image_module.open(io.BytesIO(data)).convert("RGBA")
        except Exception as error:
            print(f"skip minimap tile {archive_path.name}:{real_name}: {error}", file=sys.stderr)
            continue

        images.append((tile_x, tile_y, image))

    if not images:
        return None

    xs = [tile_x for tile_x, _tile_y, _image in images]
    ys = [tile_y for _tile_x, tile_y, _image in images]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    tile_width = max(image.width for _tile_x, _tile_y, image in images)
    tile_height = max(image.height for _tile_x, _tile_y, image in images)
    width = (max_x - min_x + 1) * tile_width
    height = (max_y - min_y + 1) * tile_height
    canvas = image_module.new("RGBA", (width, height), (0, 0, 0, 0))

    for tile_x, tile_y, image in images:
        canvas.paste(image, ((tile_x - min_x) * tile_width, (tile_y - min_y) * tile_height), image)

    slug = map_slug(map_key)
    extension = "jpg" if image_format == "jpeg" else image_format
    out_path = maps_out_dir / f"{slug}.{extension}"
    maps_out_dir.mkdir(parents=True, exist_ok=True)

    if image_format == "png":
        canvas.save(out_path, "PNG", optimize=True)
    elif image_format == "jpeg":
        background = image_module.new("RGB", canvas.size, (0, 0, 0))
        background.paste(canvas, mask=canvas.getchannel("A"))
        background.save(out_path, "JPEG", quality=88, optimize=True)
    else:
        canvas.save(out_path, "WEBP", quality=86, method=6)

    return {
        "key": map_key,
        "slug": slug,
        "aliases": sorted(
            {
                normalize_alias(map_key),
                normalize_alias(slug),
                *[normalize_alias(alias) for alias in aliases],
            }
        ),
        "url": f"/replay-maps/{out_path.name}",
        "width": width,
        "height": height,
        "tileCount": len(images),
        "grid": {
            "minX": min_x,
            "minY": min_y,
            "maxX": max_x,
            "maxY": max_y,
            "tileWidth": tile_width,
            "tileHeight": tile_height,
        },
        "sourceArchives": sorted(sources),
    }


def write_replay_map_manifest(
    maps_out_dir: pathlib.Path,
    locale: str,
    image_format: str,
    maps: list[dict],
):
    manifest = {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "locale": locale,
        "format": image_format,
        "mapCount": len(maps),
        "maps": maps,
    }
    maps_out_dir.mkdir(parents=True, exist_ok=True)
    (maps_out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def extract_minimaps(data_dir: pathlib.Path, locale: str, maps_out_dir: pathlib.Path, image_format: str, map_filter: str | None):
    image_module = ensure_pillow()
    tiles, sources, aliases_by_map, archives_seen, named_files_seen = collect_minimap_tiles(
        data_dir,
        locale,
        map_filter,
    )

    if not tiles:
        print(
            "minimaps\t0\t"
            f"archives={archives_seen}\tnamed_files={named_files_seen}\t"
            "No Interface\\WorldMap or World\\Minimaps tiles were found. This usually means the MPQs do not include a listfile; pass a client Data directory with named archives.",
            file=sys.stderr,
        )
        return

    maps = []
    archive_cache: dict[pathlib.Path, object] = {}
    for map_key in sorted(tiles, key=natural_key):
        entry = save_stitched_map(
            image_module,
            map_key,
            tiles[map_key],
            sources.get(map_key, set()),
            aliases_by_map.get(map_key, set()),
            maps_out_dir,
            image_format,
            archive_cache,
        )
        if entry:
            maps.append(entry)
            print(f"map\t{entry['key']}\t{entry['tileCount']} tiles\t{entry['url']}")
            write_replay_map_manifest(maps_out_dir, locale, image_format, maps)

    write_replay_map_manifest(maps_out_dir, locale, image_format, maps)
    print(f"manifest\t{len(maps)}\t{maps_out_dir / 'manifest.json'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--locale", default="enUS")
    parser.add_argument("--files", nargs="*", default=[])
    parser.add_argument("--raw-files", nargs="*", default=[])
    parser.add_argument("--icon-list-file")
    parser.add_argument("--icons-out-dir")
    parser.add_argument("--extract-minimaps", action="store_true")
    parser.add_argument("--maps-out-dir", default=os.path.join("public", "replay-maps"))
    parser.add_argument("--map-format", choices=["webp", "jpeg", "png"], default="webp")
    parser.add_argument("--map-filter")
    args = parser.parse_args()

    global mpyq
    mpyq = ensure_mpyq()
    data_dir = pathlib.Path(args.data_dir)
    out_dir = pathlib.Path(args.out_dir)
    requested = {f"dbfilesclient\\{name.lower()}": name for name in args.files}
    requested_raw = {normalize_mpq_name(name): name for name in args.raw_files}
    extracted: dict[str, tuple[bytes, str]] = {}
    extracted_raw: dict[str, tuple[bytes, str]] = {}
    requested_icons = icon_requests(args.icon_list_file)
    existing_icons = existing_icon_names(args.icons_out_dir)
    requested_icons = {
        mpq_name: icon_name
        for mpq_name, icon_name in requested_icons.items()
        if icon_name not in existing_icons
    }
    extracted_icons: dict[str, tuple[bytes, str]] = {}

    for archive_path in archive_paths(data_dir, args.locale):
        try:
            archive = mpyq.MPQArchive(str(archive_path))
        except Exception as error:
            print(f"skip {archive_path.name}: {error}", file=sys.stderr)
            continue

        names = {normalize_mpq_name(name): name for name in archive.files}
        for mpq_name, out_name in requested.items():
            real_name = names.get(mpq_name)
            if real_name is None:
                continue

            try:
                data = archive.read_file(real_name)
            except Exception as error:
                print(f"skip {archive_path.name}:{out_name}: {error}", file=sys.stderr)
                continue

            if data and data[:4] == b"WDBC":
                extracted[out_name] = (data, archive_path.name)

        for mpq_name, out_name in requested_raw.items():
            real_name = names.get(mpq_name)
            if real_name is None:
                continue

            try:
                data = archive.read_file(real_name)
            except Exception as error:
                print(f"skip {archive_path.name}:{out_name}: {error}", file=sys.stderr)
                continue

            if data:
                extracted_raw[out_name] = (data, archive_path.name)

        for mpq_name, icon_name in requested_icons.items():
            real_name = names.get(mpq_name)
            if real_name is None:
                continue

            try:
                data = archive.read_file(real_name)
            except Exception as error:
                print(f"skip {archive_path.name}:{icon_name}.blp: {error}", file=sys.stderr)
                continue

            if data:
                extracted_icons[icon_name] = (data, archive_path.name)

    out_dir.mkdir(parents=True, exist_ok=True)
    missing = []
    for out_name in args.files:
        found = extracted.get(out_name)
        if found is None:
            missing.append(out_name)
            continue

        data, source = found
        (out_dir / out_name).write_bytes(data)
        print(f"{out_name}\t{len(data)}\t{source}")

    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)

    missing_raw = []
    for out_name in args.raw_files:
        found = extracted_raw.get(out_name)
        if found is None:
            missing_raw.append(out_name)
            continue

        data, source = found
        raw_out = out_dir / out_name
        raw_out.parent.mkdir(parents=True, exist_ok=True)
        raw_out.write_bytes(data)
        print(f"{out_name}\t{len(data)}\t{source}")

    if missing_raw:
        print("missing raw: " + ", ".join(missing_raw), file=sys.stderr)

    if requested_icons and args.icons_out_dir:
        image_module = ensure_pillow()
        icons_out_dir = pathlib.Path(args.icons_out_dir)
        written = 0
        for icon_name, (data, source) in extracted_icons.items():
            try:
                write_icon(image_module, data, icons_out_dir / f"{icon_name}.jpg")
                written += 1
            except Exception as error:
                print(f"skip icon {source}:{icon_name}.blp: {error}", file=sys.stderr)

        missing_icons = sorted(set(requested_icons.values()) - set(extracted_icons))
        print(f"icons\t{written}\t{icons_out_dir}")
        if missing_icons:
            sample = ", ".join(missing_icons[:20])
            suffix = f" (+{len(missing_icons) - 20} more)" if len(missing_icons) > 20 else ""
            print(f"missing icons: {sample}{suffix}", file=sys.stderr)

    if args.extract_minimaps:
        extract_minimaps(
            data_dir,
            args.locale,
            pathlib.Path(args.maps_out_dir),
            args.map_format,
            args.map_filter,
        )


if __name__ == "__main__":
    main()
