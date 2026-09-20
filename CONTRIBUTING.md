# Contributing to Seedcorn

Thanks for taking the time. Contributions of every size are welcome: bug reports,
typo fixes, new templates, new features. This page tells you how to get a change
in with the least friction.

## Before you start

- **Bugs:** open an issue with steps to reproduce. A screenshot or a short screen
  recording of the timeline helps a lot for anything visual.
- **Small fixes:** just open a pull request.
- **Larger features:** open an issue first, or write a short design doc in
  [`docs/design/`](docs/design/) using the template there. The
  [design docs README](docs/design/README.md) explains the process. A few
  paragraphs on the current state, prior art, and the proposed change saves
  everyone from a big pull request that goes in the wrong direction.

## Set up

Everything runs in Docker with hot reload. No local Python or Node needed.

```bash
git clone https://github.com/<you>/seedcorn.git
cd seedcorn
SEED_DEMO=1 docker compose up --build
```

Open http://localhost:5173 and sign in as `demo` / `demo12345`. The API is at
http://localhost:8000/api/ and its docs at http://localhost:8000/api/docs/.

Source directories are mounted into the containers, so edits to `backend/` and
`frontend/` take effect immediately.

## Make your change

1. Create a branch from `main`.
2. Make the change. Keep it focused on one thing.
3. If you touch the API or the data model, add or update tests in the matching
   `tests_*.py` file under `backend/projects/` or `backend/events/`. If you add
   a migration, run `makemigrations` inside the container so it is generated
   against the project's Django version.
4. If you add a built-in template, follow the shape in
   `backend/projects/templates_builtin.py`: every task's category must exist,
   `depends_on` holds indices of earlier tasks, and a task should not start
   before its dependencies end.
5. If you change the timeline canvas, try it on a trackpad and a mouse, and at
   both 1x and 2x device pixel ratio. Safari behaves differently from Chrome
   for scroll-heavy rendering, so a check there is valuable if you can.

## Check it

```bash
docker compose exec backend python manage.py test                              # backend suite
docker compose exec backend python manage.py makemigrations --check --dry-run  # no missing migrations
docker compose exec frontend npm run build                                     # frontend builds
```

CI runs the same checks, plus Django system checks and an advisory `ruff` lint,
on every pull request.

## Open the pull request

- Write a subject in the form `Area: what changed`, for example
  `Timeline: cull event bars outside the visible range` or
  `Templates: add a conference-talk plan`. Look at `git log` for the style.
- In the description, say what changed and why. For anything visual, include a
  before and after screenshot. For a bug fix, say how to reproduce the bug on
  `main`.
- One reviewer approval is enough. Reviews are usually within a few days.

## Style

There is no formatter enforced. Match the code around you:

- Python: standard Django and DRF conventions, four-space indents, single
  quotes.
- JavaScript: plain React function components with hooks, no semicolons, two
  space indents, single quotes. No UI framework; styles live in
  `frontend/src/style.css`.
- Comments explain why, not what.

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license as the project.
