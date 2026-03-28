# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0.0] - 2026-03-27

### Added
- **Agent Conversation:** Every comment posted to the timeline is now a direct message to the agent, automatically triggering or resuming the session.
- **SQLite State Management:** Migrated from file-based JSON state to a persistent SQLite database (`.gstack/botlanes.db`) for improved scalability and atomic operations.
- **Project/Skill Details:** Display skill-specific token counts and approximate memory usage in the project and column headers.
- **Symlinked Multimedia:** Attachments and logs now use symlinked directories (`botlanes-uploads/`, `botlanes-logs/`) to bypass CLI dot-directory ignore patterns, allowing agents (like Claude Code) to read them directly.
- **Auto-updating .gitignore:** The server now automatically ensures that `.gstack/` and its symlinked directories are excluded from git.

### Changed
- **Unified Agent Runner:** Replaced separate resume/trigger paths with a single `startCardSessionRun` function for consistent prompt building and CLI invocation across both Claude and Gemini.
- **Fixed Claude Invocation:** Corrected `-p` argument handling and disabled `stdin` to prevent the CLI from hanging on interactive prompts in non-interactive mode.

### Fixed
- Fixed permission issues when creating state directories.
- Improved error handling during agent process spawning.
