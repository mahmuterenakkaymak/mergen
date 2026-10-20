"""Tests for the orchestrator's guards (2026-10-19). Run: python -m unittest discover -s hybrid/tests -v
Each test builds a throwaway git repo; agents are fakes, so nothing here calls Claude or Strata."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import hybrid_run as h  # noqa: E402

PY_TEST = "def test_add():\n    assert 1 + 1 == 2\n"
CS_TEST = "namespace A.Tests;\npublic class XTests {\n    [Fact] public void Adds() => Assert.Equal(2, 1 + 1);\n}\n"
CONFTEST = "import pytest\n\n@pytest.fixture\ndef db():\n    return 1\n"
PKG = {"name": "x", "scripts": {"test": "vitest run"}, "devDependencies": {"vitest": "1.0.0"}}
PYPROJECT = '[project]\nname = "x"\ndependencies = []\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'


class Repo:
    def __init__(self, files: dict[str, str], tasks: str = ""):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        for rel, text in files.items():
            self.write(rel, text)
        self.write("TASKS.md", tasks or "- [ ] T01 | M1 | do it | accept: python -c \"print(1)\"\n")
        for args in (["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"],
                     ["add", "-A"], ["commit", "-q", "-m", "init"]):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        self.run = h.Run(self.root)
        self.run.notify = lambda *a, **k: None
        self.before = self.run.committed_tests()

    def write(self, rel: str, text: str) -> None:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding="utf-8")

    def changed(self, allowed: str = "") -> list[str]:
        return self.run.changed_tests(self.before, allowed=allowed)

    def close(self):
        self.dir.cleanup()


ALL = {"tests/test_math.py": PY_TEST, "tests/A.Tests/XTests.cs": CS_TEST, "tests/conftest.py": CONFTEST,
       "pytest.ini": "[pytest]\ntestpaths = tests\n", "package.json": json.dumps(PKG, indent=2),
       "pyproject.toml": PYPROJECT, "tests/x.test.js": "test('a', () => expect(1).toBe(1));\n"}


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.r = Repo(ALL)

    def tearDown(self):
        self.r.close()

    def test_clean_tree_gives_no_alarm(self):
        self.assertEqual(self.r.changed(), [])

    def test_weakened_python_assert_is_caught(self):
        self.r.write("tests/test_math.py", "def test_add():\n    assert True\n")
        self.assertEqual(self.r.changed(), ["tests/test_math.py::test_add"])

    def test_new_python_test_is_allowed(self):
        self.r.write("tests/test_math.py", PY_TEST + "\ndef test_more():\n    assert 2 * 2 == 4\n")
        self.assertEqual(self.r.changed(), [])

    def test_changed_csharp_line_is_caught_and_appended_test_allowed(self):
        self.r.write("tests/A.Tests/XTests.cs", CS_TEST.replace("Assert.Equal(2, 1 + 1)", "Assert.True(true)"))
        self.assertEqual(self.r.changed(), ["tests/A.Tests/XTests.cs::*"])
        self.r.write("tests/A.Tests/XTests.cs", CS_TEST + "public class YTests { }\n")
        self.assertEqual(self.r.changed(), [])

    # finding 3: files that decide which tests run
    def test_conftest_new_fixture_allowed_new_hook_caught(self):
        self.r.write("tests/conftest.py", CONFTEST + "\n@pytest.fixture\ndef other():\n    return 2\n")
        self.assertEqual(self.r.changed(), [])
        self.r.write("tests/conftest.py", CONFTEST + "\ndef pytest_collection_modifyitems(items):\n    items.clear()\n")
        self.assertEqual(self.r.changed(), ["tests/conftest.py::hooks"])

    def test_conftest_changed_fixture_is_caught(self):
        self.r.write("tests/conftest.py", CONFTEST.replace("return 1", "return 2"))
        self.assertEqual(self.r.changed(), ["tests/conftest.py::fn:db"])

    def test_new_conftest_file_with_hook_is_caught(self):
        self.r.write("tests/sub/conftest.py", "def pytest_collection_modifyitems(items):\n    items.clear()\n")
        self.assertEqual(self.r.changed(), ["tests/sub/conftest.py::hooks"])
        self.r.write("tests/sub/conftest.py", "import pytest\n@pytest.fixture\ndef f():\n    return 1\n")
        self.assertEqual(self.r.changed(), [])

    def test_pytest_ini_addition_is_caught(self):
        self.r.write("pytest.ini", "[pytest]\ntestpaths = tests\naddopts = -k 'not slow'\n")
        self.assertEqual(self.r.changed(), ["pytest.ini::exact"])

    def test_package_json_dependency_allowed_test_script_caught(self):
        pkg = dict(PKG, devDependencies={"vitest": "1.0.0", "jsdom": "24.0.0"})
        self.r.write("package.json", json.dumps(pkg, indent=2))
        self.assertEqual(self.r.changed(), [])
        self.r.write("package.json", json.dumps(dict(PKG, scripts={"test": "echo ok"}), indent=2))
        self.assertEqual(self.r.changed(), ["package.json::runner"])

    def test_pyproject_dependency_allowed_pytest_section_caught(self):
        self.r.write("pyproject.toml", PYPROJECT.replace("dependencies = []", 'dependencies = ["sympy"]'))
        self.assertEqual(self.r.changed(), [])
        self.r.write("pyproject.toml", PYPROJECT + 'addopts = "-k not_slow"\n')
        self.assertEqual(self.r.changed(), ["pyproject.toml::runner"])

    # rename tasks: move + namespace change is not tampering, move + weaker test is
    def test_rename_with_namespace_change_is_allowed(self):
        (self.r.root / "tests/A.Tests/XTests.cs").unlink()
        self.r.write("tests/B.Tests/XTests.cs", CS_TEST.replace("namespace A.Tests", "namespace B.Tests"))
        self.assertEqual(self.r.changed(), [])

    def test_rename_with_weaker_test_is_caught_and_restored(self):
        (self.r.root / "tests/A.Tests/XTests.cs").unlink()
        self.r.write("tests/B.Tests/XTests.cs",
                     CS_TEST.replace("namespace A.Tests", "namespace B.Tests").replace("Assert.Equal(2, 1 + 1)", "Assert.True(true)"))
        tampered = self.r.changed()
        self.assertEqual(tampered, ["tests/A.Tests/XTests.cs::*"])
        self.r.run.restore_tampered(tampered)
        self.assertEqual(self.r.read("tests/A.Tests/XTests.cs"), CS_TEST)
        self.assertFalse((self.r.root / "tests/B.Tests/XTests.cs").exists())
        self.assertTrue((self.r.root / "tests/B.Tests/XTests.cs.rejected").exists())

    # finding 6: exact path match for the task-text exemption
    def test_exemption_needs_the_exact_path(self):
        r = Repo({"test_a.py": PY_TEST, "tests/test_a.py": PY_TEST})
        try:
            r.write("test_a.py", "def test_add():\n    assert True\n")
            self.assertEqual(r.changed(allowed="update tests/test_a.py"), ["test_a.py::test_add"])
            self.assertEqual(r.changed(allowed="update test_a.py, it is wrong"), [])
        finally:
            r.close()


TASKS = ("- [ ] T01 | M1 | write src.py | accept: python -c \"import os,sys; sys.exit(0 if os.path.exists('done.txt') else 1)\"\n"
         "- [ ] T02 | M1 | later task | accept: python -c \"print(1)\"\n")


class RunTaskTests(unittest.TestCase):
    def make(self, hands, brain=None):
        r = Repo({"tests/test_math.py": PY_TEST}, tasks=TASKS)

        def agent(label, prompt, model=None, env=None, cwd=None):
            return (hands if label == "hands" else brain)(r)
        r.run.agent = agent
        return r

    # finding 2: a worker that edits TASKS.md is rolled back
    def test_worker_edit_of_tasks_file_is_restored(self):
        def hands(r):
            r.write("TASKS.md", r.read("TASKS.md").replace("- [ ] T02", "- [x] T02"))
            r.write("done.txt", "ok")
            return True, ""
        r = self.make(hands)
        try:
            self.assertTrue(r.run.run_task(r.run.tasks()[0]))
            status = {t["id"]: t["done"] for t in r.run.tasks()}
            self.assertEqual(status, {"T01": True, "T02": False})
        finally:
            r.close()

    # finding 1: the rescue is guarded like the hands
    def test_rescue_that_weakens_a_test_is_not_committed(self):
        def hands(r):
            return True, ""                           # never creates done.txt -> accept fails twice
        def brain(r):
            r.write("tests/test_math.py", "def test_add():\n    assert True\n")
            r.write("done.txt", "ok")
            return True, ""
        r = self.make(hands, brain)
        try:
            self.assertFalse(r.run.run_task(r.run.tasks()[0]))
            self.assertEqual(r.read("tests/test_math.py"), PY_TEST)
            log = subprocess.run(["git", "log", "--oneline"], cwd=r.root, capture_output=True, text=True).stdout
            self.assertEqual(len(log.splitlines()), 1)  # only the init commit
        finally:
            r.close()

    # finding 1b: a local review commits only REVIEW.md and TASKS.md
    def test_local_review_side_effects_are_stashed(self):
        def brain(r):
            r.write("REVIEW.md", "1 bug")
            r.write("TASKS.md", r.read("TASKS.md") + "- [ ] T03 | M1 | fix | accept: python -c \"print(1)\"\n")
            r.write("tests/test_math.py", "def test_add():\n    assert True\n")
            return True, ""
        r = self.make(None, brain)
        try:
            r.run.local = True
            r.run.review("M1")
            files = subprocess.run(["git", "show", "--name-only", "--format=", "HEAD"], cwd=r.root,
                                   capture_output=True, text=True).stdout.split()
            self.assertEqual(sorted(files), ["REVIEW.md", "TASKS.md"])
            self.assertEqual(r.read("tests/test_math.py"), PY_TEST)
            stash = subprocess.run(["git", "stash", "list"], cwd=r.root, capture_output=True, text=True).stdout
            self.assertIn("M1 review side effects", stash)
        finally:
            r.close()


class BrokenAcceptTests(unittest.TestCase):
    def test_broken_command_is_not_retried_or_rescued(self):
        calls = []
        r = Repo({"tests/test_math.py": PY_TEST},
                 tasks="- [ ] T01 | M1 | x | accept: definitely-not-a-command-xyz --run\n")
        try:
            r.run.agent = lambda label, *a, **k: (calls.append(label), (True, ""))[1]
            self.assertFalse(r.run.run_task(r.run.tasks()[0]))
            self.assertEqual(calls, ["hands"])                  # one try, no second try, no rescue
            self.assertEqual(r.run.stats["broken_accept"], ["T01"])
        finally:
            r.close()


class AcceptCommandTests(unittest.TestCase):
    def test_trailing_explanation_is_dropped(self):
        cmd = "npx vitest run tests/cta.test.js (new test reads src/style.css: the rule uses animation-name)"
        self.assertEqual(h.clean_accept(cmd), "npx vitest run tests/cta.test.js")

    def test_nested_brackets_in_the_explanation(self):
        cmd = "npx vitest run tests/w.test.js (new test builds buildTownMeshes(generateTown(...)) headless and asserts"
        self.assertEqual(h.clean_accept(cmd), "npx vitest run tests/w.test.js")

    def test_backticks_are_dropped(self):
        self.assertEqual(h.clean_accept("`npm test`"), "npm test")

    def test_real_brackets_are_kept(self):
        for cmd in ['python -c "print(1 + (2))"', "dotnet test --filter (Name~Login)", 'node -e "f(a (b))"']:
            self.assertEqual(h.clean_accept(cmd), cmd)


if __name__ == "__main__":
    unittest.main()
