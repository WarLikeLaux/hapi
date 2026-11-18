#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
SVG="$ROOT/svg"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/hapi-brand.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

if command -v magick >/dev/null 2>&1; then
    IM=magick
elif command -v convert >/dev/null 2>&1; then
    IM=convert
else
    echo "ImageMagick is required" >&2
    exit 1
fi

render() {
    local source="$1"
    local size="$2"
    local target="$3"
    "$IM" -background none -density 384 "$source" -resize "${size}x${size}" -depth 8 -strip "$target"
}

backplate='#302345'
mark="$SVG/hapi-mark.svg"

# Keep the same helmet geometry for the tray, the app and the maskable icon.
framed_svg() {
    local radius="$1"
    local transform="$2"
    sed "s|<g id=\"helmet\">|<rect width=\"256\" height=\"256\" rx=\"$radius\" fill=\"$backplate\" />\\n    <g id=\"helmet\" transform=\"$transform\">|" "$mark"
}

framed_svg 54 'translate(11.52 11.52) scale(.91)' > "$OUT/icon.svg"
framed_svg 0 'translate(11.52 11.52) scale(.91)' > "$OUT/apple.svg"
framed_svg 0 'translate(25.6 25.6) scale(.8)' > "$OUT/maskable.svg"

# Small browser tab icons and the larger PWA and Apple Touch icons.
favicons=()
for size in 16 24 32 48 64 192 512; do
    target="$REPO_ROOT/web/public/pwa-${size}x${size}.png"
    render "$OUT/icon.svg" "$size" "PNG32:$target"
    case "$size" in
        16|32|48) favicons+=("$target") ;;
    esac
done
"$IM" "${favicons[@]}" "$OUT/favicon.ico"

for size in 192 512; do
    render "$OUT/maskable.svg" "$size" "PNG24:$REPO_ROOT/web/public/pwa-maskable-${size}x${size}.png"
done
render "$OUT/apple.svg" 180 "PNG24:$OUT/apple-touch-icon-180x180.png"
cp "$REPO_ROOT/web/public/pwa-512x512.png" "$REPO_ROOT/web/public/icon.png"
cp "$SVG/hapi-monochrome.svg" "$REPO_ROOT/web/public/mask-icon.svg"
render "$SVG/hapi-monochrome.svg" 64 "PNG32:$REPO_ROOT/web/public/notification-badge.png"

for count in {1..9} 9+; do
    size=84
    if [[ "$count" == '9+' ]]; then
        size=65
    fi
    "$IM" -size 128x128 canvas:none -fill "$backplate" \
        -draw 'roundrectangle 0,0 127,127 27,27' \
        -fill '#FFF8F8' -font DejaVu-Sans-Bold -pointsize "$size" \
        -gravity center -annotate +0+0 "$count" -depth 8 -strip \
        "PNG32:$REPO_ROOT/web/public/badge-${count/+/plus}.png"
done

for surface in web website docs; do
    cp "$OUT/favicon.ico" "$REPO_ROOT/$surface/public/favicon.ico"
done
for surface in web website; do
    cp "$OUT/icon.svg" "$REPO_ROOT/$surface/public/icon.svg"
    cp "$OUT/apple-touch-icon-180x180.png" "$REPO_ROOT/$surface/public/apple-touch-icon-180x180.png"
done
for surface in website docs; do
    cp "$OUT/icon.svg" "$REPO_ROOT/$surface/public/logo.svg"
done

tray_frames=()
for size in 16 20 24 32 40 48 64 128; do
    target="$OUT/tray-${size}.png"
    render "$mark" "$size" "PNG32:$target"
    tray_frames+=("$target")
done
"$IM" "${tray_frames[@]}" "$ROOT/hapi-tray.ico"

echo "Synced HAPI brand assets from $ROOT"
