# Fiwo Web Portal

This is the public-facing website for the Fiwo language. It contains the translator, workbook, and dictionary downloads.

## How to Run
Open `index.html` in your browser. Since it has no backend, it can be run directly from the filesystem or served via a simple local server (e.g., `python3 -m http.server`).

## Publishing (going live)
The live site is **https://fiwo-web.com**, served by GitHub Pages from `github.com/JoshTheBirdy/fiwo-web`. This repo has no remote of its own — publish with the deploy script in the Fiwo project:

```bash
~/Desktop/J-Space/Shared_space/Fiwo/Tools/deploy_web.sh          # preview what would change
~/Desktop/J-Space/Shared_space/Fiwo/Tools/deploy_web.sh --push   # publish (live in ~1 minute)
```

It copies this folder into the clone at `../Fiwo-Web-live`, commits and pushes over SSH. Commit here first — it refuses to deploy uncommitted work.

- **Don't use GitHub's browser uploader** — it refuses files over 25 MB.
- **The voice** ships as `tts/fiwo.onnx.part0-2` + `tts/fiwo.onnx.parts.json` (written by `build_web_study.mjs`); `fiwo-voice.js` joins them and checks the SHA-256. The whole `tts/fiwo.onnx` is never uploaded. After retraining, bump `VOICE_CACHE` in both `fiwo-voice.js` and `sw.js`.
- **`CNAME`** exists only in the live repo and points fiwo-web.com at Pages; the script never touches it.
- **`?v=` tags** in `index.html` are content hashes written by `build_web_study.mjs` — don't hand-edit them.

## Data Source & Generated Files
> [!WARNING]
> Do **NOT** manually edit the following files:
> - `dictionary.js`
> - `DerivedDictionary.js`
> - `Fiwo-Dictionary.txt`
> - `Fiwo-Derived-Dictionary.txt`
> - `Fiwo-AI-instructions.txt`

These files are pure outputs auto-generated from the master language Lexicon. Any manual edits here will be completely lost the next time the master build script runs.
To add new words or change the dictionary, you must edit the central Fiwo Lexicon.

## Development & AI Guide
If you are an AI assistant or a developer trying to update the language or understand how it works, please read **`/home/josh/Desktop/J-Space/Shared_space/Fiwo/Nofap.md`** first. It is the definitive guide on the ecosystem.
