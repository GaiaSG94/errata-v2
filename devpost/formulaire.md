# Devpost form — pre-filled fields

Copy each section into the matching Devpost field.

## Project name

Errata

## Tagline (≤ 60 characters)

`Revise the mistake you repeat, not the whole chapter.` (53 characters)

Alternative: `Snap your corrected test. Find your habit. Fix it.` (50)

## Short description

Errata reads your corrected math test, types every mistake against a closed list of 12 error types,
and builds the one short drill that works on the mistake you keep repeating. After three papers you
no longer see a list of mistakes: you see your error profile. No paper is ever stored; history stays
on your device.

## Inspiration

A student looks at a corrected test for ten seconds and puts it away. The most personal information
of their schooling — the list of the mistakes they keep making — is thrown away within a day. Every
existing tool starts from the blank exercise to give the answer. None starts from the correction,
which already contains the diagnosis.

## What it does

Six steps: the photo is normalised, the student's name is masked, a multimodal vision model reads the
teacher's marks, each mistake is classified into a closed taxonomy (E01 lost sign → E12 unjustified
conclusion, plus E99 untyped), the error profile is aggregated locally, and a targeted drill is
generated and checked by a relevance guard (right type, doesn't give the answer away, right level).
A clean paper gives "no mistakes found" and no drill — Errata never invents a mistake. Teacher mode:
a batch of papers gives the class's error statistics, "what to re-teach on Monday", and a CSV export.

## How we built it

Vite + React + TypeScript + Tailwind, Zod schemas on every model answer, IndexedDB storage, no data
backend. A minimal edge proxy (Cloudflare Worker) keeps the InferHub key server-side, caps the
quota, falls back across a chain of seven vision models and trips a 60-second circuit breaker; a
BYOK mode takes over if the quota runs out. Prompts are versioned in `prompts/`. 206 offline tests,
CI in under 5 minutes on GitHub-hosted runners, merges through a Mergify queue, GitHub Pages deploy
on every push. An offline demo replays answers recorded on the real model, with their real timings.

## Challenges we ran into

Classic OCR is unusable on handwriting, so everything goes through one multimodal call. The first
version invented mistakes on a clean paper: `copiePropre` became an expected answer, and
classification is no longer called in that case. A model that returns 0.95 confidence everywhere
makes the threshold useless: hence a calibration instruction and a corpus annotation at 0.31 that
must end up E99. Generation drifted to the general topic instead of the faulty gesture: hence the
second verification pass. And on the last day the vision marketplace answered `503` for hours: we
added a global time budget, progress messages and an honest error with **Try again**.

## Accomplishments that we're proud of

Zero false positives on a clean paper, enforced by a test that forbids any network call in that
case. A measurable diagnosis instead of a list of sentences. A ~127 KB gzip bundle. A UI that never
adds red to a paper already marked in red.

## What we learned

A diagnosis is only worth something if it is stable: the same paper analysed twice must give the
same type. The closed taxonomy and the confidence threshold aren't technical constraints, they are
what lets a student trust their own profile. And honesty is a feature: saying "no exercise available
for this type" earns more credibility than any animation.

## What's next for Errata

Other subjects (the architecture already allows it; the taxonomies are missing), teaching validation
on a real class, LMS integration for the teacher export, and a second vision provider so that one
marketplace's outage never blocks a live analysis.

## Built with

- typescript
- react
- vite
- tailwindcss
- zod
- indexeddb (idb-keyval)
- vitest
- inferhub (OpenAI-compatible multimodal API)
- cloudflare-workers
- github-pages
- github-actions
- mergify

## Tracks to select

- [x] Best AI Hack
- [x] Best Deployed / Shipped App
- [x] Best Design & UX
- [x] Overall
- [ ] Hardware (no physical part: don't select)

## Links

- Live demo: https://gaiasg94.github.io/errata-v2/
- Code: https://github.com/GaiaSG94/errata-v2
- Edge proxy health: https://errata-proxy.rature.workers.dev/health
- Video: _(paste the public link, checked in a private window)_

## Team

_(To fill in by the submitter: list everyone who contributed to the code, each registered on Devpost
for IceHacks. The repository history is public; the team field must match it.)_
