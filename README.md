# integration-mock

[![CI](https://github.com/LudwigGerdes/integration-mock/actions/workflows/ci.yml/badge.svg)](https://github.com/LudwigGerdes/integration-mock/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/integration-mock.svg)](https://www.npmjs.com/package/integration-mock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Build and test n8n workflows without calling the real APIs. integration-mock runs on your machine and answers as Slack, Stripe, HubSpot and other services would, so a test run sends no real messages, uses no quota and needs no API key. Anything it has no answer for fails with a clear error instead of empty data.

![integration-mock starting, serving a mocked API, answering an unknown route with an error, and showing the request log](https://raw.githubusercontent.com/LudwigGerdes/integration-mock/main/docs/demo/quickstart.gif)

## Installation

Requires Node.js 20 or newer.

Run it without installing:

```bash
npx integration-mock --help
```

Add it to a project:

```bash
npm install --save-dev integration-mock
```

Build from source:

```bash
git clone https://github.com/LudwigGerdes/integration-mock.git
cd integration-mock
pnpm install && pnpm build
```

## Getting started

Start the mock, turn on the Slack pack, and post a message to it:

```bash
npx integration-mock start
npx integration-mock packs enable slack
curl -X POST http://127.0.0.1:8080/slack/api/chat.postMessage
```

**Expected output:**

```text
proxy started on :8080 (admin :8081)
enabled: slack
{"channel":"C1H9RESGL","message":{"attachments":[{"fallback":"This is an attachment's fallback","id":1,"text":"This is an attachment"}],"bot_id":"B19LU7CSY","subtype":"bot_message","text":"Here's a message for you","ts":"1503435956.000247","type":"message","username":"ecto1"},"ok":true,"ts":"1503435956.000247"}
```

No message was sent anywhere. See what was called, then stop the mock:

```bash
npx integration-mock log
npx integration-mock stop
```

**Expected output:**

```text
2026-09-21T07:32:48.556Z	POST	slack	/api/chat.postMessage	200	slack:POST:/api/chat.postMessage#0
stopped
```

In n8n, set an HTTP Request node's URL to `http://127.0.0.1:8080/slack/api/chat.postMessage` to use the mock from a workflow.

## Usage

See which services can be mocked, and turn some on:

```bash
integration-mock packs list
integration-mock packs enable slack hubspot
```

Get the base URL to point a workflow at:

```bash
integration-mock url slack
```

Make the next call fail, to test an error branch or retry settings:

```bash
integration-mock faults set slack --status 503 --once
```

Mock an API that has no pack yet:

```bash
integration-mock packs init acme --domain api.acme.com
```

**Expected output:**

```text
created ./.integration-mock/packs/acme
next: edit routes/main.json, then `integration-mock packs validate acme`
```

This creates:

```text
.integration-mock/
└── packs/
    └── acme/
        ├── pack.json
        └── routes/
            └── main.json
```

Mock nodes whose URL you cannot change, such as the Slack node, by running n8n and the mock together in Docker:

```bash
integration-mock up
```

Run a workflow once for real, then keep testing against that recorded run:

```bash
integration-mock snapshot latest --workflow <id>
```

## Documentation

Full documentation is at [workflowtools.dev/integration-mock](https://workflowtools.dev/integration-mock/):

- [Command line](https://workflowtools.dev/integration-mock/cli)
- [Using it from n8n](https://workflowtools.dev/integration-mock/n8n)
- [Packs](https://workflowtools.dev/integration-mock/packs)
- [Snapshots, credentials and verify](https://workflowtools.dev/integration-mock/snapshots)
- [FAQ and compatibility](https://workflowtools.dev/integration-mock/faq)

## License

[MIT](LICENSE) © Ludwig Gerdes

The packs are generated from the services' published OpenAPI descriptions; [NOTICE](NOTICE) lists each source. Not affiliated with n8n GmbH or with any of the services mocked.
