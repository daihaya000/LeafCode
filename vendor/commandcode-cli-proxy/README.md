CommandCode CLI Proxy bridge for OpenCode.

This plugin exposes a loopback OpenAI-compatible proxy and delegates requests
to the installed CommandCode CLI (`command-code`/`cmdc`). It intentionally does
not call the Provider API, so Go-plan accounts use their normal CLI access.
