"""In-process content tests: no verifier subprocess, Git call, or native dispatch."""
import hashlib
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("verifier", HERE / "claude-pilot-verify-v2.py")
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)
WORK = (HERE / "work-policy.fixture.md").read_bytes()
REVIEW = (HERE / "review-policy.fixture.md").read_bytes().replace(
    b"WORK_SHA256", hashlib.sha256(WORK).hexdigest().encode("ascii"))
BASE, HEAD = "a" * 40, "b" * 40


class ContentContract(unittest.TestCase):
    def mode(self, documents, head=HEAD):
        return VERIFIER.classify_documents(documents, head, BASE)

    def test_exact_base_requires_absent_pilot_directory(self):
        self.assertEqual(self.mode(None, BASE), "baseline")
        self.assertEqual(self.mode({}, BASE), "invalid")
        self.assertEqual(self.mode({"work-policy.md": WORK}, BASE), "invalid")

    def test_empty_nonbase_is_never_baseline(self):
        self.assertEqual(self.mode(None), "invalid")
        self.assertEqual(self.mode({}), "invalid")

    def test_work_alone_is_partial_and_both_documents_are_complete(self):
        self.assertEqual(self.mode({"work-policy.md": WORK}), "partial")
        self.assertEqual(self.mode({"work-policy.md": WORK, "review-policy.md": REVIEW}), "complete")

    def test_review_without_work_or_stale_digest_fails(self):
        self.assertEqual(self.mode({"review-policy.md": REVIEW}), "invalid")
        stale = REVIEW.replace(hashlib.sha256(WORK).hexdigest().encode(), b"0" * 64)
        self.assertEqual(self.mode({"work-policy.md": WORK, "review-policy.md": stale}), "invalid")

    def test_every_required_clause_matters(self):
        for name, body in [("work-policy.md", WORK), ("review-policy.md", REVIEW)]:
            for line in body.splitlines(keepends=True):
                if not line.startswith(b"- "):
                    continue
                with self.subTest(document=name, missing=line):
                    documents = {"work-policy.md": WORK, "review-policy.md": REVIEW}
                    documents[name] = body.replace(line, b"", 1)
                    # Refresh the digest for A so failure is the missing content, not stale B.
                    if name == "work-policy.md":
                        documents["review-policy.md"] = REVIEW.replace(
                            hashlib.sha256(WORK).hexdigest().encode(),
                            hashlib.sha256(documents[name]).hexdigest().encode())
                    self.assertEqual(self.mode(documents), "invalid")

    def test_extra_documents_and_hidden_or_contradictory_content_fail(self):
        for extra in [b"\n<!-- unrelated -->\n", b"\nActually allowance resets.\n", b"\x00"]:
            self.assertEqual(self.mode({"work-policy.md": WORK + extra}), "invalid")
        self.assertEqual(self.mode({"work-policy.md": WORK, "extra.md": b"extra"}), "invalid")
        self.assertEqual(self.mode({"work-policy.md": b"```\n" + WORK + b"```\n"}), "invalid")


if __name__ == "__main__":
    unittest.main()
