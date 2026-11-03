# Fork

A branching AI chat that runs entirely in your browser. No server, no accounts, no
subscriptions — your conversations live in your browser's storage and your AI keys stay
on your machine.

Fork is built for the way people actually think: when a conversation starts going in two
directions, you split it. Every message can open a new branch, the branch diagram on the
side shows the whole tree at a glance, and you can jump between branches, compare two of
them side by side, or ask the AI to synthesize the best of both.

## What it does

- **Branch from any message** — click "Branch from this reply" (or the branch button on a
  message) and a box opens there; what you type becomes a new lane in the tree.
- **Branch diagram** — a git-style rail on the right shows main and every branch, with
  named lanes, fork markers, hover previews and a chip list you can click to jump.
- **Branch awareness** — with it switched on, the AI is told which branch it is answering
  from and that other branches exist, without being shown their content.
- **Compare branches** — pick two branches and the AI lines them up: agreements,
  differences, trade-offs, then one recommendation that takes the best of both.
- **Find branches by topic** — a straight-line chat can be split retroactively into
  branches wherever the topic changes. Pure word matching, no AI call.
- **Streaming replies with timing** — answers appear word by word, a timer runs while you
  wait, and each reply shows how long it took.
- **Export / import** — your whole tree as a JSON file, so nothing is locked in.
- **Markdown and math** — replies render headings, lists, tables, code and LaTeX formulas.

## AI providers

All calls go straight from your browser to the provider. Nothing passes through a server.

| Provider | Key needed | Notes |
| --- | --- | --- |
| Free AI | no | Default. No key, no account, works immediately. |
| Groq | yes | Fastest replies; free key from console.groq.com. |
| Google Gemini | yes | Free key from aistudio.google.com/apikey. Retired model ids are handled automatically. |
| In-browser model | no | Runs a small model inside the page — no key, but the first load is a large download. |

## Running it

```sh
npm install
npm run dev
```

Open the printed address. Add a key under Settings if you want Groq or Gemini; otherwise
the free provider works straight away.

## Tests

The tree rules (message alternation, lane layout, branch naming, topic splitting) are
pure functions with their own tests.

```sh
npm run test
```

## Where your data lives

Conversations, your selected provider and your keys are stored in this browser only
(`localStorage`). Clearing site data deletes them. Export first if you want to keep them.

## Built with

TanStack Start, React, TypeScript, Tailwind CSS, react-markdown + KaTeX.
