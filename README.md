# Stems Plugin

A [Signals & Sorcery](https://signalsandsorcery.com) plugin for generating AI audio from text prompts and splitting it into stems.

<p align="center">
  <img src="assets/signals-and-sorcery.png" alt="Signals & Sorcery" width="420" />
</p>

> Part of the **[Signals & Sorcery](https://signalsandsorcery.com)** ecosystem.

## What it does

- Generate audio from text descriptions (ambient pads, drones, full mixes, foley, etc.)
- Optionally split a generated clip into vocals / drums / bass / other stems
- Per-track volume, pan, mute, and solo controls
- FX rack per track (EQ, compressor, chorus, phaser, delay, reverb)
- Regenerate any track with a different prompt

## Install

From within Signals & Sorcery: **Settings > Manage Plugins > Add Plugin** and enter:

```
https://github.com/shiehn/sas-stems-plugin
```

Or clone manually into `~/.signals-and-sorcery/plugins/@signalsandsorcery/stems/`.

## Development

Built with the [@signalsandsorcery/plugin-sdk](https://github.com/shiehn/sas-plugin-sdk). See the [Plugin SDK docs](https://signalsandsorcery.com/plugin-sdk/) for the full API reference.

## The Signals & Sorcery Ecosystem

- **[Signals & Sorcery](https://signalsandsorcery.com)** — the flagship AI music production workstation
- **[sas-plugin-sdk](https://github.com/shiehn/sas-plugin-sdk)** — TypeScript SDK for building generator plugins
- **[sas-synth-plugin](https://github.com/shiehn/sas-synth-plugin)** — AI MIDI generation with Surge XT
- **[sas-loops-plugin](https://github.com/shiehn/sas-loops-plugin)** — Sample / loop library browser with time-stretching
- **[DeclarAgent](https://github.com/shiehn/DeclarAgent)** — Declarative agent + MCP transport for S&S

<p align="center">
  <a href="https://signalsandsorcery.com">signalsandsorcery.com</a>
</p>

## License

MIT
