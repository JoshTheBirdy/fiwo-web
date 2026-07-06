# Fiwo Web Portal

This is the public-facing website for the Fiwo language. It contains the translator, workbook, and dictionary downloads.

## How to Run
Open `index.html` in your browser. Since it has no backend, it can be run directly from the filesystem or served via a simple local server (e.g., `python3 -m http.server`).

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
