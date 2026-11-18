# HAPI brand assets

[`svg/hapi-mark.svg`](svg/hapi-mark.svg) is the master for the white helmet with a dark visor and two lavender lights. The [Windows tray icon](hapi-tray.ico) uses the helmet on a transparent background, with 16–128 px frames. The website, docs, and web app use an aubergine backplate so the white helmet reads against light backgrounds. Maskable PWA icons reserve more space around the helmet for platform cropping. [Safari pinned tabs](svg/hapi-monochrome.svg) use a single-color version.

Run the export from the repository root after editing a master. It requires ImageMagick and DejaVu Sans Bold for the numbered tab favicons.

```bash
./assets/brand/export.sh
```
