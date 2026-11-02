# unpen

Convert [pen.dev](https://www.pen.dev) `.pen` designs into files other design tools open:

| Target | Output | Status |
|---|---|---|
| OpenPencil | `<name>.fig` | Works on our samples |
| Figma | the same `<name>.fig` | Works on our samples; not yet confirmed by opening in Figma |
| Doop | `html/*.html`, one page per top-level frame | Experimental: colors and fonts load, layout of content-sized boxes is wrong |

unpen drives the [OpenPencil](https://github.com/open-pencil/open-pencil) CLI, which reads `.pen` and writes `.fig`. The `.pen` fixes it needs are not in a published OpenPencil release yet, so setup builds a pinned revision locally.

## Setup

Requires Node 22.18+ and git. Bun comes with the install.

```sh
npm install
npm run setup     # clones and builds OpenPencil into .openpencil/ (about 4 minutes, once)
```

## Use

```sh
npm run unpen -- path/to/design.pen
npm run unpen -- designs/*.pen --to figma -o out
```

| Option | Default | |
|---|---|---|
| `-t, --to` | `openpencil,figma,doop` | Any of `openpencil`, `figma`, `fig`, `doop`, `html` |
| `-o, --out` | `unpen-out` | Each input gets its own folder inside |

Each `<out>/<name>/` contains:

- `<name>.fig`: open it in OpenPencil, or drag it into Figma.
- `html/NN-<frame>.html` and `html/manifest.json`: one standalone page per top-level frame, with its fonts and styles in `NN-<frame>.assets/`.
- `report.json`: what was written, what failed, and which images were missing.

### Images

A `.pen` file links images by path, usually relative to the file. Copy the image folders that sit next to the `.pen` along with it, or they come out blank. unpen lists missing images when it runs. Images linked with `../` or an absolute path are skipped by OpenPencil and listed separately.

### Large files

Every HTML page is exported by its own OpenPencil run, four at a time, so a file with dozens of frames takes a few minutes. Use `--to figma` to skip HTML.

## Feedback

When something looks wrong, send:

1. The `report.json` from the output folder.
2. Which target (OpenPencil, Figma, or HTML) and which frame.
3. A screenshot of the frame in pen.dev next to the same frame in the target.
4. The `.pen` file, with its image folders, if you can share it.

Known issues:

- HTML: boxes that size to their content collapse, because OpenPencil exports auto-layout children as absolutely positioned.

## Development

```sh
npm test               # unit tests and an end-to-end run on test/fixtures/card.pen
npm run test:samples   # the same checks on every .pen in samples/ (gitignored); slow
npm run typecheck
npm run build          # compiles to dist/
```

The end-to-end checks convert a `.pen`, then:

- compare the `.fig` with the `.pen`: node counts, every layer's name, type and size, and a pixel comparison of each frame's render;
- open each HTML page in headless Chromium and check that every asset, CSS variable and font loads, and that every layer sits where the design puts it.

`npx playwright install chromium` is needed once for the browser checks.

`UNPEN_OPENPENCIL_CHECKOUT=/path/to/open-pencil` runs against another OpenPencil checkout, and `UNPEN_OPENPENCIL=/path/to/openpencil` against an installed CLI.
