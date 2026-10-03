"""Overall task progress combined from stage progress (download, ASR, correction); never decreases."""

from __future__ import annotations

DOWNLOAD_WEIGHT = 0.3
CORRECTION_WEIGHT = (
    0.15  # correction overlaps transcription; it only owns the tail of the bar
)


class TaskProgress:
    def __init__(self, has_download: bool, correction_enabled: bool) -> None:
        self._download_w = DOWNLOAD_WEIGHT if has_download else 0.0
        self._correction_w = CORRECTION_WEIGHT if correction_enabled else 0.0
        self._download = self._asr = self._correction = 0.0
        self._max = 0.0

    @property
    def correction(self) -> float:
        """Share of the whole audio already corrected; never decreases."""
        return self._correction

    def overall(
        self,
        *,
        download: float | None = None,
        asr: float | None = None,
        correction: float | None = None,
    ) -> float:
        if download is not None:
            self._download = max(self._download, download)
        if asr is not None:
            self._asr = max(self._asr, asr)
        if correction is not None:
            # the corrector reports a ratio of the text transcribed *so far*; scale it to the whole audio
            share = correction if self._asr >= 1.0 else correction * self._asr
            self._correction = max(self._correction, round(share, 4))
        rest = 1.0 - self._download_w
        work = (
            1.0 - self._correction_w
        ) * self._asr + self._correction_w * self._correction
        self._max = max(
            self._max, round(self._download_w * self._download + rest * work, 4)
        )
        return self._max
