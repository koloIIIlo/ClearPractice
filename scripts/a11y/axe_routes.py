"""Accessibility audit of every route with axe-core, in light and dark (roadmap 7.7).

Runs against the browser preview (`npm run dev`, mock data) at 1280x900 and
prints the violations per route; exits with 1 if there are any. Each work
package that adds a route adds it to ROUTES.

Setup (once):
  - Python with Playwright and Chrome:  pip install playwright==1.58.0
  - axe-core's axe.min.js, either from  npm install --save-dev --save-exact axe-core@4.10.2
    (found automatically in node_modules) or any copy passed with --axe.

Usage:
  npm run dev            (in another terminal)
  python -E scripts/a11y/axe_routes.py [--base http://localhost:1420] [--axe path/to/axe.min.js] [--only /sessions ...]
"""
import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROUTES = [
    "/", "/welcome", "/exercises", "/exercises?tab=prompts", "/exercises?tab=guides",
    "/exercises/ex-repeat", "/exercises/ex-thought-groups", "/exercises/ex-imitate", "/exercises/ex-expression",
    "/practice/ex-repeat", "/practice/ex-thought-groups", "/practice/ex-imitate", "/practice/ex-expression", "/practice/done",
    "/sessions", "/sessions/trash", "/sessions/s-01", "/sessions/s-02/attempt/2", "/sessions/s-02/compare",
    "/phrases", "/phrases?review=1", "/progress", "/progress?view=rehearsed", "/progress?view=unfamiliar", "/progress?view=real",
    "/compare?a=s-07-a1&b=s-01-a2",
    "/journey", "/journey?area=fluency", "/journey/achievements",
    "/settings/audio", "/settings/practice", "/settings/appearance", "/settings/transcription",
    "/settings/coaching", "/settings/data", "/settings/about", "/nope",
]
TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"]


def find_axe(given: str | None) -> Path:
    candidates = [Path(given)] if given else [Path("node_modules/axe-core/axe.min.js")]
    for path in candidates:
        if path.is_file():
            return path
    sys.exit("axe.min.js not found: install axe-core (see the header) or pass --axe <path>.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://localhost:1420")
    parser.add_argument("--axe")
    parser.add_argument("--only", nargs="*", help="audit only these routes")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    axe = find_axe(args.axe).read_text(encoding="utf-8")
    routes = args.only or ROUTES
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        for scheme in ("light", "dark"):
            page = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme=scheme).new_page()
            for route in routes:
                page.goto(f"{args.base.rstrip('/')}/#{route}", wait_until="load")
                page.wait_for_timeout(1500)
                page.add_script_tag(content=axe)
                violations = page.evaluate(
                    """async (tags) => (await axe.run(document, { runOnly: { type: 'tag', values: tags } })).violations
                        .map(v => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)""",
                    TAGS,
                )
                failures += len(violations)
                print(f"[{scheme}] {route}: {'clean' if not violations else ''}")
                for line in violations:
                    print(f"    {line}")
            page.context.close()
        browser.close()
    print(f"{failures} violation(s) on {len(routes)} routes in light and dark.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
