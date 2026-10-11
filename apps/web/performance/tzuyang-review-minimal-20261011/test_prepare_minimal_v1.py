import unittest
from prepare_minimal_v1 import edit, sha


class MinimalReviewSafety(unittest.TestCase):
    def setUp(self):
        self.row = {'adminLocked': False, 'channel_name': 'tzuyang', 'status': 'approved',
                    'tzuyang_review': '합성 리뷰가 맛있음.', 'reviewSha256': sha('합성 리뷰가 맛있음.')}
        self.spec = {'kind': 'editorial', 'replacements': [['맛있음.', '맛있다고 평가했습니다.']]}
        self.job = {'content': {'segments': [{'segment': 0, 'text': '합성 음식은 아주 맛있어요.'}]}}

    def test_user_or_admin_owned_records_cannot_enter_change_plan(self):
        for field, value in [('adminLocked', True), ('channel_name', 'other'), ('status', 'deleted')]:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'TARGET_SCOPE_DENIED'):
                edit({**self.row, field: value}, self.spec, self.job)

    def test_changed_preimage_cannot_reuse_old_review_approval(self):
        with self.assertRaisesRegex(ValueError, 'PREIMAGE_DRIFT'):
            edit({**self.row, 'tzuyang_review': '동시 변경한 리뷰'}, self.spec, self.job)

    def test_ambiguous_replacement_cannot_edit_two_claims(self):
        text = '합성 리뷰가 맛있음. 다른 리뷰도 맛있음.'
        with self.assertRaisesRegex(ValueError, 'REPLACEMENT_NOT_UNIQUE'):
            edit({**self.row, 'tzuyang_review': text, 'reviewSha256': sha(text)}, self.spec, self.job)

    def test_source_changes_require_exact_segment_quote(self):
        for quote in [None, '자막에 없는 주장']:
            spec = {**self.spec, 'kind': 'source_correction', 'evidence': [] if quote is None else [{'segment': 0, 'quote': quote}]}
            with self.subTest(quote=quote), self.assertRaises(ValueError):
                edit(self.row, spec, self.job)

    def test_editorial_change_preserves_the_rest_of_the_review(self):
        self.assertEqual(edit(self.row, self.spec, self.job), '합성 리뷰가 맛있다고 평가했습니다.')
        self.assertEqual(self.row['tzuyang_review'], '합성 리뷰가 맛있음.')


if __name__ == '__main__':
    unittest.main()
