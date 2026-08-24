---
title: Troubleshooting
description: Common failures and how to diagnose them.
---

## The app is silent after load

Do not call `Tone.start`, build buses, or load samples during module evaluation.
Register `registerAudioGestureTrigger` during app setup and perform all audio
bootstrap inside its callback. Inspect the returned promise when calling
`startAudioEngine` directly; failures are intentionally retryable.

## A cue returns `-1`

The resolver either has not initialized, the cue is absent, or its sheet could
not be created. Use `strict: true` during development to turn malformed maps or
HTTP failures into rejected initialization. Confirm that `file` omits its
extension and is relative to `audioBaseUrl`.

## Audio works in one browser but not another

Provide at least two formats that cover the target browsers, normally `webm`
and `m4a`. The resolver passes formats to Howler in order. Run the asset verifier
and inspect network responses and browser decoding errors.

## Volume changes do not persist

`setAndPersistBusVolume` requires a store whose `update` actually writes the
complete `audioVolumes` patch it receives. Rejections are not swallowed: the
runtime mix rolls back and the returned promise rejects.

## Focus restore changes an explicit mute

This indicates an older package version or direct mute logic outside the bridge.
Current releases layer focus, global preference, and manual mutes independently.
Use `registerFocusLossMute(false)` when disabling the preference.

## Asset verification cannot measure duration or LUFS

Install `ffmpeg` and ensure both `ffmpeg` and `ffprobe` are on `PATH`. Use
`fast: true` only when structural and byte-budget checks are sufficient. A
missing required sprite bus or missing audio root is always a failure.
