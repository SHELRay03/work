# -*- coding: utf-8 -*-
"""剪映草稿批量生成：按文件名编号匹配视频与字幕，顺序拼接为一个剪映草稿。

原 d:\\A英语剧\\webapp 独立应用，整合为工具箱后端模块。
"""

import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path

import pyJianYingDraft as draft
from pyJianYingDraft import TrackType, trange
from pyJianYingDraft.time_util import srt_tstamp

CACHE_DIR = Path(os.environ.get("JIANYING_CACHE_DIR", r"d:\A英语剧\_webapp_cache"))
DEFAULT_DRAFT_FOLDER = os.environ.get("JIANYING_DRAFT_FOLDER", r"d:\JianyingPro Drafts")
VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".avi")
SUB_EXTS = (".srt",)
VIDEO_HINTS = ["原剧", "压制操作", "0", "新建文件夹"]
SUB_HINTS = ["英文旁白", "results"]
NUM_RE = re.compile(r"(\d+)")


def number_of(name):
    nums = NUM_RE.findall(os.path.splitext(os.path.basename(name))[0])
    return nums[-1] if nums else None


def safe_rel(rel):
    parts = [p for p in Path(str(rel).replace("\\", "/")).parts
             if p not in ("", ".", "..") and not p.endswith(":")]
    return Path(*parts) if parts else Path("unnamed")


def collect_dir(root):
    videos, subs = {}, {}
    for dirpath, _, files in os.walk(root):
        for fn in files:
            num = number_of(fn)
            if num is None:
                continue
            full = os.path.join(dirpath, fn)
            low = fn.lower()
            if low.endswith(VIDEO_EXTS):
                videos.setdefault(num, []).append(full)
            elif low.endswith(SUB_EXTS):
                subs.setdefault(num, []).append(full)
    return videos, subs


def prefer(paths, hints):
    def rank(p):
        parts = Path(p).parts
        for i, hint in enumerate(hints):
            if hint in parts:
                return i
        return len(hints)
    return sorted(paths, key=rank)[0]


def sanitize(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "draft"


def merge(dst, src):
    for key, value in src.items():
        dst.setdefault(key, []).extend(value)


def load_srt_cues(path):
    cues = []
    with open(path, "r", encoding="utf-8-sig") as fh:
        lines = fh.readlines()

    idx = 0
    while idx < len(lines):
        line = lines[idx].strip()
        idx += 1
        if " --> " not in line:
            continue
        start_str, end_str = line.split(" --> ", 1)
        start_str = start_str.strip().split()[0].replace(".", ",")
        end_str = end_str.strip().split()[0].replace(".", ",")
        text = []
        while idx < len(lines) and lines[idx].strip():
            text.append(lines[idx].strip())
            idx += 1
        try:
            cues.append((srt_tstamp(start_str), srt_tstamp(end_str), "\n".join(text)))
        except (ValueError, IndexError):
            continue
    return cues


def fmt_time(us):
    ms = int(round(us / 1000.0))
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"


def build_draft(videos, subs, draft_folder, name):
    Path(draft_folder).mkdir(parents=True, exist_ok=True)
    folder = draft.DraftFolder(str(draft_folder))

    pairs = []
    for num in sorted(videos, key=int):
        if num in subs:
            pairs.append((num, prefer(videos[num], VIDEO_HINTS), prefer(subs[num], SUB_HINTS)))
    if not pairs:
        return {"ok": False, "error": "没有找到编号匹配的视频/字幕对", "clips": []}

    first = draft.VideoMaterial(pairs[0][1])
    script = folder.create_draft(sanitize(name), first.width or 1080,
                                 first.height or 1920, allow_replace=True)
    script.append_tracks([draft.TrackSpec(TrackType.video, "video")])

    cursor = 0
    clips = []
    entries = []
    seq = 0
    for num, video, srt in pairs:
        material = draft.VideoMaterial(video)
        duration = material.duration
        if not duration:
            clips.append({"number": num, "ok": False, "error": "无法读取视频时长"})
            continue
        try:
            script.add_segment(draft.VideoSegment(material, trange(cursor, duration)), "video")
        except Exception as exc:
            clips.append({"number": num, "ok": False, "error": str(exc)})
            continue

        cues = load_srt_cues(srt)
        kept = 0
        for start, end, text in cues:
            start = max(start, 0)
            end = min(end, duration)
            if start >= duration or end <= start:
                continue
            entries.append((cursor + start, cursor + end, text))
            kept += 1

        clips.append({"number": num, "ok": True, "video": os.path.basename(video),
                      "srt": os.path.basename(srt), "start": cursor, "duration": duration,
                      "cues": kept, "dropped": len(cues) - kept})
        cursor += duration

    if entries:
        entries.sort(key=lambda item: item[0])
        tmp_path = None
        prev_end = 0
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".srt", delete=False,
                                             encoding="utf-8") as tmp:
                tmp_path = tmp.name
                for start, end, text in entries:
                    start = max(start, prev_end)
                    if end <= start:
                        continue
                    seq += 1
                    tmp.write(f"{seq}\n{fmt_time(start)} --> {fmt_time(end)}\n{text}\n\n")
                    prev_end = end
            script.import_srt(tmp_path, "subtitle")
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)

    script.save()
    return {"ok": any(c["ok"] for c in clips), "name": sanitize(name),
            "clips": clips, "cues": seq, "duration": cursor}


def default_name(video_dir, subtitle_dir, prefix, mode):
    if prefix.strip():
        return sanitize(prefix)
    if mode == "path":
        try:
            common = os.path.commonpath([str(video_dir), str(subtitle_dir)])
        except ValueError:
            common = str(video_dir)
        base = os.path.basename(common.rstrip("\\/"))
        return sanitize(base or "合集")
    return "合集"


def generate(mode, uploads, video_dir, subtitle_dir, draft_folder, name_prefix):
    """生成剪映草稿。

    uploads: [(rel_path, fileobj)]，仅 upload 模式使用（复制到缓存目录）。
    返回结果 dict；目录无效时返回 {"error": ...}。
    """
    if mode == "path":
        vd = Path(video_dir.strip().strip('"'))
        sd = Path(subtitle_dir.strip().strip('"'))
        if not vd.is_dir() or not sd.is_dir():
            return {"error": "视频或字幕目录不存在"}
    else:
        session = CACHE_DIR / uuid.uuid4().hex[:8]
        session.mkdir(parents=True, exist_ok=True)
        for rel, fileobj in uploads:
            dest = session / safe_rel(rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as fh:
                shutil.copyfileobj(fileobj, fh)
        vd = sd = session

    videos, subs = {}, {}
    for d in {str(vd), str(sd)}:
        v, s = collect_dir(d)
        merge(videos, v)
        merge(subs, s)

    name = default_name(vd, sd, name_prefix, mode)
    result = build_draft(videos, subs, draft_folder or DEFAULT_DRAFT_FOLDER, name)
    result["draft_folder"] = str(draft_folder or DEFAULT_DRAFT_FOLDER)
    return result
