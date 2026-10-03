from task_progress import TaskProgress


def test_local_without_correction_is_asr_progress() -> None:
    p = TaskProgress(has_download=False, correction_enabled=False)
    assert p.overall(asr=0.5) == 0.5
    assert p.overall(asr=1.0) == 1.0


def test_url_with_correction_weights_stages_and_never_decreases() -> None:
    p = TaskProgress(has_download=True, correction_enabled=True)
    a = p.overall(download=1.0)
    b = p.overall(asr=0.5)
    c = p.overall(correction=0.2)
    d = p.overall(asr=0.4)  # a late, lower report cannot move the bar back
    assert a == 0.3 and 0.3 < b < c
    assert d == c
    assert p.overall(asr=1.0, correction=1.0) == 1.0


def test_correction_progress_is_share_of_whole_audio_and_never_decreases() -> None:
    p = TaskProgress(has_download=False, correction_enabled=True)
    p.overall(asr=0.5)
    p.overall(
        correction=0.5
    )  # half of the text transcribed so far = a quarter of the audio
    assert p.correction == 0.25
    p.overall(
        correction=0.25
    )  # more text arrived, ratio dips; the shown value must not
    assert p.correction == 0.25
    p.overall(asr=1.0)
    p.overall(correction=0.8)
    assert p.correction == 0.8
    p.overall(correction=1.0)
    assert p.correction == 1.0
