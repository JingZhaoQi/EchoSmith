"""Deterministic transcript cleanup for ASR output."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any

VALID_ACCURACY_MODES = {"fast", "balanced", "accurate"}
VALID_DOMAIN_PROFILES = {"general", "sermon", "academic", "meeting", "tech"}

ACCURACY_LABELS = {
    "fast": "快速",
    "balanced": "均衡",
    "accurate": "高准确率",
}

DOMAIN_LABELS = {
    "general": "通用媒体",
    "sermon": "讲道/神学",
    "academic": "学术讲座",
    "meeting": "会议访谈",
    "tech": "编程技术",
}


@dataclass(frozen=True)
class DomainProfile:
    id: str
    label: str
    replacements: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class EnhancementOptions:
    accuracy_mode: str = "balanced"
    domain_profile: str = "general"

    def normalized(self) -> "EnhancementOptions":
        mode = (
            self.accuracy_mode
            if self.accuracy_mode in VALID_ACCURACY_MODES
            else "balanced"
        )
        profile = (
            self.domain_profile
            if self.domain_profile in VALID_DOMAIN_PROFILES
            else "general"
        )
        return EnhancementOptions(accuracy_mode=mode, domain_profile=profile)


DOMAIN_PROFILES: dict[str, DomainProfile] = {
    "general": DomainProfile(id="general", label=DOMAIN_LABELS["general"]),
    "sermon": DomainProfile(
        id="sermon",
        label=DOMAIN_LABELS["sermon"],
        replacements=(
            ("斯温的保座", "施恩的宝座"),
            ("玉兰河", "约旦河"),
            ("玉览河", "约旦河"),
            ("加券", "家眷"),
            ("家卷", "家眷"),
            ("按年以前", "八年以前"),
            ("真大的的赐福", "神大大的赐福"),
            ("真大大的赐福", "神大大的赐福"),
            ("神大的这赐福", "神大大的赐福"),
            ("使书们见证", "使我们见证"),
            ("书们见证", "使我们见证"),
            ("苏房市场", "租房市场"),
            ("实字家", "十字架"),
            ("十子架", "十字架"),
            ("岛高尔", "祷告"),
            ("大细丝", "大祭司"),
            ("蜀林", "属灵"),
            ("蜀灵", "属灵"),
            ("属林", "属灵"),
            ("属练", "属灵"),
            ("署龄", "属灵"),
            ("署名", "属灵"),
            ("基录", "基督"),
            ("生明", "圣名"),
            ("圣音", "圣名"),
            ("圣明", "圣名"),
            ("成一", "称义"),
            ("恩点", "恩典"),
            ("毁改", "悔改"),
            ("心神病", "新生命"),
            ("新生病", "新生命"),
            ("福印", "福音"),
            ("经门", "经文"),
            ("经闻", "经文"),
            ("经问", "经文"),
            ("金文", "经文"),
            ("呼教学", "护教学"),
            ("呼叫学", "护教学"),
            ("呼叫些", "护教学"),
            ("呼叫选", "护教学"),
            ("互教学", "护教学"),
        ),
    ),
    "academic": DomainProfile(
        id="academic",
        label=DOMAIN_LABELS["academic"],
        replacements=(
            ("哈伯常数", "哈勃常数"),
            ("暗物制", "暗物质"),
            ("广义相对论", "广义相对论"),
        ),
    ),
    "meeting": DomainProfile(
        id="meeting",
        label=DOMAIN_LABELS["meeting"],
        replacements=(
            ("OKR", "OKR"),
            ("KPI", "KPI"),
        ),
    ),
    "tech": DomainProfile(
        id="tech",
        label=DOMAIN_LABELS["tech"],
        replacements=(
            ("派森", "Python"),
            ("配森", "Python"),
            ("杰森", "JSON"),
            ("阿皮爱", "API"),
            ("数据库", "数据库"),
        ),
    ),
}

_CJK = r"\u3400-\u4dbf\u4e00-\u9fff"
_PUNCT = "。！？!?，,；;：:、"
_FILLER_PATTERN = re.compile(rf"(^|[{_PUNCT}\n])\s*(嗯|呃|额|啊)[，,、\s]+")


def get_domain_profile(profile_id: str) -> DomainProfile:
    return DOMAIN_PROFILES.get(profile_id, DOMAIN_PROFILES["general"])


def get_accuracy_label(mode: str) -> str:
    return ACCURACY_LABELS.get(mode, ACCURACY_LABELS["balanced"])


def enhance_text(text: str, options: EnhancementOptions) -> str:
    options = options.normalized()
    cleaned = text or ""

    cleaned = _normalize_spacing(cleaned)
    cleaned = _apply_domain_replacements(
        cleaned, get_domain_profile(options.domain_profile)
    )
    if options.accuracy_mode != "fast":
        cleaned = _remove_spoken_fillers(cleaned)
    cleaned = _normalize_spacing(cleaned)
    return cleaned.strip()


def enhance_segments(segments: list[Any], options: EnhancementOptions) -> list[Any]:
    enhanced: list[Any] = []
    for segment in segments:
        text = enhance_text(getattr(segment, "text", ""), options)
        enhanced.append(replace(segment, text=text))
    return enhanced


def _normalize_spacing(text: str) -> str:
    text = re.sub(rf"(?<=[{_CJK}])\s+(?=[{_CJK}])", "", text)
    text = re.sub(rf"\s+([{_PUNCT}])", r"\1", text)
    text = re.sub(rf"([{_PUNCT}])\s+(?=[{_CJK}])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def _apply_domain_replacements(text: str, profile: DomainProfile) -> str:
    result = text
    for wrong, right in sorted(
        profile.replacements, key=lambda item: len(item[0]), reverse=True
    ):
        result = result.replace(wrong, right)
    return result


def _remove_spoken_fillers(text: str) -> str:
    previous = None
    result = text
    while result != previous:
        previous = result
        result = _FILLER_PATTERN.sub(r"\1", result)
    return result
