# Changelog

Notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3](https://github.com/jbcom/gesture-audio/compare/v0.2.2...v0.2.3) (2026-08-24)


### Bug Fixes

* **sonar:** emit lcov coverage ([7ff6813](https://github.com/jbcom/gesture-audio/commit/7ff6813ff8319fed519b6f048cf269bd0b15f046))
* **sonar:** emit lcov coverage ([d75436f](https://github.com/jbcom/gesture-audio/commit/d75436f0f4082460eb1fc9fa7e03e2a20bba3a64))

## [0.2.2](https://github.com/jbcom/gesture-audio/compare/v0.2.1...v0.2.2) (2026-08-24)


### Bug Fixes

* **ci:** publish releases through CD OIDC ([dfd037a](https://github.com/jbcom/gesture-audio/commit/dfd037a78a1d7a98ecc491e26e86f22c1d8c3f51))
* **ci:** publish releases through CD OIDC ([fbc6dd8](https://github.com/jbcom/gesture-audio/commit/fbc6dd81027ef97c7647038ae0c412a91bcc32e9))
* **ci:** recognize release-please app identity ([58179af](https://github.com/jbcom/gesture-audio/commit/58179af4c6d9b52e62ce71a77f0db2a9d0d84838))
* **ci:** recognize release-please app identity ([e023a6d](https://github.com/jbcom/gesture-audio/commit/e023a6dc11f727e56cf8e0404eea0b50de970f37))
* **ci:** satisfy repository policy gate ([6d9b0b4](https://github.com/jbcom/gesture-audio/commit/6d9b0b4b201134b2c14480e4418720cce3b3c387))
* **ci:** satisfy repository policy gate ([d04f495](https://github.com/jbcom/gesture-audio/commit/d04f4955af6c17e97016e9187f698bdbc25bcc4f))
* **ci:** satisfy required maintenance gates ([37c23c3](https://github.com/jbcom/gesture-audio/commit/37c23c33a3dfb385cc379eaa4db0833ecc6582da))
* **ci:** satisfy required maintenance gates ([49cf734](https://github.com/jbcom/gesture-audio/commit/49cf734853c5f61098f22a47c356213998f7f659))
* **release:** use trusted automation token ([0d8f5b3](https://github.com/jbcom/gesture-audio/commit/0d8f5b3ff8afa872e4362f5740d53d8944b0923f))
* **release:** use trusted automation token ([76020f0](https://github.com/jbcom/gesture-audio/commit/76020f03a92159f09a3ad609afb8bdaaf5b92d64))

## [0.2.1](https://github.com/jbcom/gesture-audio/compare/v0.2.0...v0.2.1) (2026-08-24)


### Bug Fixes

* **ci:** provision audio tools for release verification ([8907405](https://github.com/jbcom/gesture-audio/commit/8907405d80bb134869ccd6bc5e0d3f4f1a3cffb4))
* **ci:** provision audio tools for release verification ([237bf1b](https://github.com/jbcom/gesture-audio/commit/237bf1b178a7591ddbdca7257d14b48ab4639378))

## [0.2.0](https://github.com/jbcom/gesture-audio/compare/v0.1.2...v0.2.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* publish as unscoped gesture-audio

### Features

* **audio-engine:** extract @arcade-cabinet/audio-engine package ([#1](https://github.com/jbcom/gesture-audio/issues/1)) ([2d31b6b](https://github.com/jbcom/gesture-audio/commit/2d31b6b4b352655b48d800a17d44e1f177a863fb))
* **ci:** add trusted SonarQube Cloud quality gate ([1dd7a73](https://github.com/jbcom/gesture-audio/commit/1dd7a73e832c0b1f357914f0e321971c33c720ed))
* migrate documentation and agentic repository controls ([4c2bc8a](https://github.com/jbcom/gesture-audio/commit/4c2bc8afb6828351fa2a304d127ede9fc7311f4e))
* migrate documentation and agentic repository controls ([3b3ac82](https://github.com/jbcom/gesture-audio/commit/3b3ac82bd947db49ae89a7e78d50eaeeaffbb324))
* publish as unscoped gesture-audio ([0aeb14b](https://github.com/jbcom/gesture-audio/commit/0aeb14be61fe0ffd4b2aaf08c8f445ffc4b5460b))
* publish gesture-audio as a production-ready OSS package ([#1](https://github.com/jbcom/gesture-audio/issues/1)) ([edb11cc](https://github.com/jbcom/gesture-audio/commit/edb11cc8d3638f753b99dd6995baef72c0ca440e))


### Bug Fixes

* **audio-engine:** keep failed unlocks retryable ([#4](https://github.com/jbcom/gesture-audio/issues/4)) ([5c47f30](https://github.com/jbcom/gesture-audio/commit/5c47f30a742eb18336eea67e7ba4b568d3cb4fc7))
* **audio-engine:** preserve bus levels across mute cycles ([#3](https://github.com/jbcom/gesture-audio/issues/3)) ([93a0518](https://github.com/jbcom/gesture-audio/commit/93a0518876fb5c6517a278f4b07a443ce8daff37))
* **ci:** keep fork policy independent from validation ([946ffb6](https://github.com/jbcom/gesture-audio/commit/946ffb6adb813ec1d4a297ece0506f9d1cd27169))
* **ci:** provision audio tools for Sonar coverage ([d6bd44c](https://github.com/jbcom/gesture-audio/commit/d6bd44ca09535fc1000644568cb8cd9c3426d20f))
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
