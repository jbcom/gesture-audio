# Changelog

Notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/jbcom/gesture-audio/compare/v0.1.2...v0.2.0) (2026-08-24)


### Features

* **audio-engine:** extract @arcade-cabinet/audio-engine package ([#1](https://github.com/jbcom/gesture-audio/issues/1)) ([2d31b6b](https://github.com/jbcom/gesture-audio/commit/2d31b6b4b352655b48d800a17d44e1f177a863fb))
* migrate documentation and agentic repository controls ([4c2bc8a](https://github.com/jbcom/gesture-audio/commit/4c2bc8afb6828351fa2a304d127ede9fc7311f4e))
* migrate documentation and agentic repository controls ([3b3ac82](https://github.com/jbcom/gesture-audio/commit/3b3ac82bd947db49ae89a7e78d50eaeeaffbb324))
* publish gesture-audio as a production-ready OSS package ([#1](https://github.com/jbcom/gesture-audio/issues/1)) ([edb11cc](https://github.com/jbcom/gesture-audio/commit/edb11cc8d3638f753b99dd6995baef72c0ca440e))


### Bug Fixes

* **audio-engine:** keep failed unlocks retryable ([#4](https://github.com/jbcom/gesture-audio/issues/4)) ([5c47f30](https://github.com/jbcom/gesture-audio/commit/5c47f30a742eb18336eea67e7ba4b568d3cb4fc7))
* **audio-engine:** preserve bus levels across mute cycles ([#3](https://github.com/jbcom/gesture-audio/issues/3)) ([93a0518](https://github.com/jbcom/gesture-audio/commit/93a0518876fb5c6517a278f4b07a443ce8daff37))
* **ci:** keep fork policy independent from validation ([946ffb6](https://github.com/jbcom/gesture-audio/commit/946ffb6adb813ec1d4a297ece0506f9d1cd27169))
* **docs:** serve the landing artwork from Sourcey output ([e677bf1](https://github.com/jbcom/gesture-audio/commit/e677bf1e58389acd46720896e75db1c2f3cb8232))
* **tooling:** run Biome pre-commit hook on source files ([a18a766](https://github.com/jbcom/gesture-audio/commit/a18a766ed60831679e17c797cbac554dadc6b4e9))
* **tooling:** run Biome pre-commit hook on source files ([670521a](https://github.com/jbcom/gesture-audio/commit/670521acffc1f47a33de550bf4d5d09b394be46a))

## [Unreleased]

### Added

- Standalone OSS package extraction with dual ESM/CommonJS distribution.
- Gesture-gated Tone.js lifecycle, bus graph, Howler sprite resolver,
  preferences bridge, and audio asset verification tools.
- Production documentation, examples, governance, CI, release automation, and
  package-consumer validation.
