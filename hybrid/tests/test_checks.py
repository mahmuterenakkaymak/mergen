"""Tests for the whole-project checks (2026-10-20). Run: python -m unittest discover -s hybrid/tests -v
Throwaway git repos and fake reviews; nothing here calls Claude or Strata."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import checks  # noqa: E402
import hybrid_run as h  # noqa: E402
from test_guards import PKG, Repo  # noqa: E402

OK = 'python -c "print(1)"'
FAIL = 'python -c "import sys; print(\'3 failed: tests/start.test.js\'); sys.exit(1)"'
DONE = "- [x] T01 | M1 | do it | accept: python -c \"print(1)\"\n"


class DetectTests(unittest.TestCase):
    def test_vitest_project(self):
        r = Repo({"package.json": json.dumps(PKG)})
        self.assertEqual(checks.detect_suites(r.root), ["npx vitest run"])

    def test_dotnet_solution(self):
        r = Repo({"App.sln": ""})
        self.assertEqual(checks.detect_suites(r.root), ["dotnet test --nologo"])

    def test_checks_json_replaces_detection_and_adds_smoke(self):
        r = Repo({"package.json": json.dumps(PKG),
                  ".hybrid/checks.json": json.dumps({"suite": [OK], "smoke": [FAIL]})})
        self.assertEqual(checks.commands(r.root), [("suite", OK), ("smoke", FAIL)])
        n, failures = checks.run(r.root)
        self.assertEqual(n, 2)
        self.assertEqual([f["kind"] for f in failures], ["smoke"])
        self.assertIn("3 failed", failures[0]["out"])


class GateTests(unittest.TestCase):
    def gate(self, cfg: dict | None) -> str:
        files = {".hybrid/checks.json": json.dumps(cfg)} if cfg is not None else {}
        self.repo = Repo(files)                     # keep the temp dir alive
        return self.repo.run.gate("M1")

    def test_red_names_the_failing_command_and_output(self):
        text = self.gate({"suite": [FAIL]})
        self.assertTrue(text.startswith("The whole-project checks are RED after M1"))
        self.assertIn("tests/start.test.js", text)
        self.assertIn("stale", text)

    def test_green(self):
        self.assertEqual(self.gate({"suite": [OK]}), h.GATE_GREEN.format(n=1))

    def test_nothing_to_run(self):
        self.assertEqual(self.gate(None), h.GATE_NONE)

    def test_review_prompt_carries_the_gate(self):
        prompt = h.REVIEW_PROMPT.format(ms="M2", gate="GATE-TEXT")
        self.assertIn("GATE-TEXT", prompt)
        self.assertIn("Contracts", prompt)


class FinalGateTests(unittest.TestCase):
    def build(self, cfg: dict) -> list[tuple[str, str]]:
        r = Repo({".hybrid/checks.json": json.dumps(cfg)}, tasks=DONE)
        reviews = []
        r.run.visual_review = lambda ms: None
        r.run.start_review = lambda ms, gate="": reviews.append(("milestone", ms))
        r.run.review = lambda ms, gate="": reviews.append(("final", gate[:40]))
        r.run.build()
        return reviews

    def test_red_at_the_end_gets_one_foreground_review(self):
        reviews = self.build({"suite": [FAIL]})
        self.assertEqual(reviews[0], ("milestone", "M1"))
        self.assertEqual([k for k, _ in reviews], ["milestone", "final"])
        self.assertTrue(reviews[1][1].startswith("The whole-project checks are RED"))

    def test_green_at_the_end_needs_no_review(self):
        self.assertEqual(self.build({"suite": [OK]}), [("milestone", "M1")])


class StepTests(unittest.TestCase):
    def test_dict_and_shot_steps(self):
        import browser_check

        class Page:
            viewport_size = {"width": 390, "height": 900}
            def __init__(self):
                self.calls = []
            def click(self, sel, timeout=0):
                self.calls.append(("click", sel))
            def fill(self, sel, text, timeout=0):
                self.calls.append(("fill", sel, text))

            class mouse:  # noqa: N801 - mirrors Playwright's page.mouse
                clicks = []
                @staticmethod
                def click(x, y):
                    Page.mouse.clicks.append((x, y))

        page, shots = Page(), []
        for step in [{"click": "#save"}, {"fill": ["#name", "Ali"]}, "shot:after", "click"]:
            browser_check.run_step(page, step, shots.append)
        self.assertEqual(page.calls, [("click", "#save"), ("fill", "#name", "Ali")])
        self.assertEqual(shots, ["after"])
        self.assertEqual(Page.mouse.clicks, [(195, 450)])   # centre of the page's own viewport, not 1366x768


if __name__ == "__main__":
    unittest.main()
