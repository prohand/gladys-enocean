# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release workflow
moves that section under the version it ships, and the section becomes the notes of
the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-11-20

### Added

- EnOcean gateway (USB 300, TCM 310, any ESP3 module) reached over TCP through
  ser2net, reconnected on its own after a loss.
- Sensors: temperature (A5-02), temperature and humidity (A5-04), light (A5-06),
  occupancy (A5-07), CO2 (A5-09-04), contacts (D5-00-01), window handles
  (F6-10-00) and rocker switches (F6-02).
- Actuators: relays that learned a rocker (F6-02-01), Eltako central command
  relays and dimmers (A5-38-08), D2-01 electronic switches and dimmers with UTE
  pairing.
- Configuration screen: test the connection, devices heard (lines to paste), learn
  mode, pair an actuator.
- Scene triggers: switch pressed, window handle turned, unknown device heard,
  gateway lost. Scene actions: press a virtual switch, send a teach-in.
- "EnOcean radio" dashboard widget.
- Interface and documentation in English, French, German and Spanish.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build), Release,
  multi-arch build and GitHub Release workflows; Dependabot.

[Unreleased]: https://github.com/prohand/gladys-enocean/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/prohand/gladys-enocean/releases/tag/v1.0.1
