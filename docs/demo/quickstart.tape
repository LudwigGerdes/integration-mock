# NOTE: vhs 0.12.0 exits 0 and writes no file (charmbracelet/vhs#787); use 0.11.0.
# Hero GIF for the README: the offline base-URL loop in about ten seconds.
# Render with `vhs docs/demo/quickstart.tape` (https://github.com/charmbracelet/vhs).
# Assumes `integration-mock` is on PATH (npm link / pnpm link --global from packages/cli),
# port 8080 is free, and the working directory is the repository root, where the
# example `weather` pack lives under .integration-mock/packs/.

Output docs/demo/quickstart.gif

Set Shell "zsh"
Set FontSize 16
Set Width 1200
Set Height 400
Set Padding 20
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"

Hide
  Type 'alias integration-mock="node $PWD/packages/cli/dist/bin.js"' Enter
  Type "export INTEGRATION_MOCK_HOME=$(mktemp -d) && clear" Enter
Show

Type "integration-mock start"
Enter
Sleep 1.2s

Type "integration-mock packs enable weather"
Enter
Sleep 700ms

Type "integration-mock url weather"
Enter
Sleep 700ms

Type "curl http://127.0.0.1:8080/weather/dev/weather"
Enter
Sleep 1.5s

Type "curl http://127.0.0.1:8080/weather/nope"
Enter
Sleep 2s

Type "integration-mock log"
Enter
Sleep 2.5s

Type "integration-mock stop"
Enter
Sleep 800ms
