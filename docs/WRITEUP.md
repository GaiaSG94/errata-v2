# Errata — write-up

## 1. The problem

A student hands in a test. The teacher marks it, annotates it, hands it back. The student looks at
it for ten seconds, sees the grade, and puts it in their bag. That's it.

Yet that paper holds the only truly personal information of their whole schooling: the exact list
of their mistakes. Not "you need to revise fractions", but "you lost a sign while expanding, like
last week, and like in the test before that".

That information is thrown away within a day. And it is all the more valuable because mistakes are
not random: a student repeats the same ones all year long, without ever being able to name them.

The teacher does see the pattern. But writing a tailored exercise for 30 students, every week, is
simply not possible. Feedback stays collective.

## 2. The idea

Everyone uses AI to **get the answer**. Photomath solves the photographed exercise, ChatGPT explains
it. These tools remove the effort — they target no weakness, because they don't know the student's
history.

Errata flips the gesture: **you don't photograph the exercise, you photograph the correction.**

The marked paper is the only artefact that already contains the diagnosis. We just had to read it.

- 1st paper → a diagnosis
- 3rd paper → a pattern ("88 % of your mistakes are a lost sign")
- 5th paper → a plan

You no longer revise a chapter. You revise your habit.

## 3. What we built

A static web app, no account, no database, built around six steps:

1. **Ingest** — the photo is normalised (resized, contrast stretched): a paper photographed with a
   phone in a corridor is dull, and the teacher's pencil disappears.
2. **Anonymise** — the header banner is pixelated before anything is displayed. The name never
   leaves the device unmasked.
3. **Read** — one multimodal call reads the teacher's marks: crosses, "sign!", "justify",
   handwritten corrections. No classic OCR: on handwriting it is unusable.
4. **Classify** — each mistake gets **one** code from a closed taxonomy of 12 types, with a
   confidence score. The model is not allowed to invent a category, and every answer is validated
   against a strict schema.
5. **Aggregate** — the error profile is built locally, in IndexedDB.
6. **Generate** — a drill targeted at the dominant type, then a **second pass** that checks it really
   works on that type, does not give away the original solution, and is at the right level. Two
   attempts at most, then an honest message.

For teachers: a batch of papers gives the class's error statistics, "what to re-teach on Monday",
and a CSV export. Exactly the same pipes, a different view.

Infrastructure: GitHub Pages for the app, a Cloudflare Worker as edge proxy (server-side key, quota,
fallback across a chain of seven vision models, 60-second circuit breaker), and an offline demo that
replays answers recorded on the real model, with their real timings.

## 4. Hard decisions

**A closed taxonomy instead of a free prompt.** This is the project's structural decision. A label
invented by the model ("algebra error", "sign problem") is neither measurable, nor comparable from
one paper to the next, nor defensible in front of a technical jury. Twelve codes, one signature per
code, and an `E99` "untyped" for what doesn't fit. Consequence: the profile becomes a statistic, not
a list of sentences.

**A 0.6 confidence threshold, with `E99` excluded from the profile.** Better an untyped mistake than
a mistyped one: a classification error propagates into every following paper and skews the profile
for good.

**`E11` (copying mistake) flagged but weighted zero.** A slip is not a gap. Counting it would make
the app say "your weakness is that you copy badly", which is true, useless, and discouraging. It is
shown, it doesn't weigh.

**Zero data backend.** No database, no authentication, no personal data on a server. History lives
in the browser, exportable and deletable in one click. A minimal edge proxy hides the key and caps
the quota — it is the project's only server component.

**The name is masked before display, not after.** A school paper carries a name, sometimes a class.
Pixelating the header banner costs a few milliseconds and keeps a photo of a paper from becoming
personal data in circulation.

**No red in the interface.** The paper already arrives covered in red marks. Adding red to the UI
adds shame to a document that is already marked. The diagnosis is amber, progress is green. It isn't
an aesthetic choice: it is what makes the app usable by a student who just failed a test.

## 5. What failed

**Classic OCR on handwriting.** First reflex, first failure: recognising the teacher's handwritten
marks is unusable. All reading now goes through the multimodal model, in a single call.

**False positives on clean papers.** The first extraction prompt "found" mistakes where the teacher
had written nothing — the worst possible flaw for this product: an Errata that invents mistakes
destroys trust instantly. Fixed in two steps: `copiePropre` (clean paper) became an explicitly
expected answer, and the classification step is **no longer called at all** in that case. The
matching test checks that no network call is made.

**Over-confident scores.** A model that answers 0.95 everywhere makes the threshold useless. The
prompt now carries an explicit calibration instruction, and the validation corpus contains a 0.31
annotation that must end up as `E99`.

**Off-topic exercises.** Without a second pass, generation drifts to the general topic — fraction
exercises when the mistake was about the common denominator. Hence the guard, and the "two attempts,
then we say so" rule: an off-topic exercise is worse than no exercise.

**The shared quota.** A single set of keys for the whole demo is a breaking point on judging day.
BYOK wasn't planned at first; it became mandatory.

**A saturated upstream.** On the last day, every vision model of the chain answered
`503 no available provider` for hours, and the analysis screen waited in silence. We added a global
time budget, progress messages naming the model being tried, and an honest error with **Try again**.
That is also why the sample papers replay answers recorded on the real model: the demo keeps working
when the provider doesn't.

## 6. What we learned

A diagnosis is only worth something if it is **stable**: the same paper analysed twice must give
the same type of mistake. The closed taxonomy and the confidence threshold are not technical
constraints, they are the conditions for a student to trust their profile.

The product doesn't sell AI, it sells **recurrence**. One multimodal call is not enough: local
accumulation is what turns a gadget into a tool.

Finally: honesty is a feature. Saying "no exercise available for this type", showing the confidence,
announcing that no mistake was found on a clean paper — these three behaviours earn more credibility
than any animation.

## 7. What's next

- **Other subjects:** the architecture already allows it; the taxonomies are missing (physics, then
  languages).
- **Teaching validation:** measure on a real class whether working on your dominant type improves
  the next test. Without that measurement, Errata remains a good intuition.
- **LMS integration:** a teacher exporting class statistics wants to drop them into their school's
  platform, not into a CSV.
- **A second vision provider:** so that one marketplace's outage never blocks a live analysis.

## 8. AI tools used

Full, detailed declaration: [`DECLARATION-IA.md`](DECLARATION-IA.md).

In short: the product **calls** an OpenAI-compatible multimodal API served by InferHub (reading the
marks, classification, generation, relevance guard). Development was assisted by coding agents
(Claude Code, opencode), and every line is understood, explainable and demonstrable by the author.
