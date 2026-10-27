# -*- coding: utf-8 -*-
"""剪映草稿批量生成：按文件名编号匹配视频与字幕，顺序拼接为一个剪映草稿。

原 d:\\A英语剧\\webapp 独立应用，整合为工具箱后端模块。
"""

import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

import pyJianYingDraft as draft
from pyJianYingDraft import TrackType, trange
from pyJianYingDraft.time_util import srt_tstamp

CACHE_DIR = Path(os.environ.get("JIANYING_CACHE_DIR", r"d:\A英语剧\_webapp_cache"))
DEFAULT_DRAFT_FOLDER = os.environ.get("JIANYING_DRAFT_FOLDER", r"d:\JianyingPro Drafts")
VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".avi")
SUB_EXTS = (".srt",)
VIDEO_HINTS = ["原剧", "压制操作", "0", "新建文件夹"]

# 字幕轨道定义：名称 + 路径特征词（忽略大小写、匹配路径子串）+ 文件名后缀模式
# hints 按顺序匹配，先到先得；没有匹配到的条目归入 SUB_DEFAULT_TRACK 兜底轨道。
SUB_LANES = [
    ("subtitle_en", ["英文旁白", "results", "english"], [".en.", ".en_", "_en.", "_en_"]),
    ("subtitle_zh", ["中文旁白", "中英字幕", "替换", "zh原版", "中文", "zh_cn", "zh"], [".zh.", ".zh_", "_zh.", "_zh_"]),
]
SUB_DEFAULT_TRACK = "subtitle"
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
    """从 paths 中选一条最匹配 hints 的（路径包含 hint 子串即算匹配）。"""
    if not paths:
        raise ValueError("paths 为空")
    if not hints:
        return paths[0]  # 无 hint 时随便取第一条
    def rank(p):
        low_p = p.replace("\\", "/").lower()
        for i, hint in enumerate(hints):
            if hint.lower() in low_p:
                return i
        return len(hints)
    return sorted(paths, key=rank)[0]


def match_lane(path, lanes):
    """给定一个 srt 路径，返回它所属的 lane_name；没有匹配返回 None。

    先匹配路径子串关键词，再匹配文件名后缀模式（如 .en. / .zh.）。
    路径关键词匹配优先级更高，避免平铺目录里通用名被后缀规则误判。
    """
    low_path = path.replace("\\", "/").lower()
    low_name = Path(path).name.lower()
    for lane_name, hints, suffixes in lanes:
        for hint in hints:
            if hint.lower() in low_path:
                return lane_name
        for suffix in suffixes:
            if suffix.lower() in low_name:
                return lane_name
    return None


def sanitize(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "draft"


def merge(dst, src):
    for key, value in src.items():
        dst.setdefault(key, []).extend(value)


def parse_srt_text(text):
    """从字符串解析 SRT → [(start_us, end_us, text), ...]。"""
    cues = []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    idx = 0
    while idx < len(lines):
        line = lines[idx].strip()
        idx += 1
        if " --> " not in line:
            continue
        start_str, end_str = line.split(" --> ", 1)
        start_str = start_str.strip().split()[0].replace(".", ",")
        end_str = end_str.strip().split()[0].replace(".", ",")
        buf = []
        while idx < len(lines) and lines[idx].strip():
            buf.append(lines[idx].strip())
            idx += 1
        try:
            cues.append((srt_tstamp(start_str), srt_tstamp(end_str), "\n".join(buf)))
        except (ValueError, IndexError):
            continue
    return cues


def load_srt_cues(path):
    with open(path, "r", encoding="utf-8-sig") as fh:
        return sanitize_cues(parse_srt_text(fh.read()))


def sanitize_cues(cues, max_duration_us=20_000_000, gap_us=50_000):
    """修正字幕时间戳异常，返回新 cues 列表。

    保持原始顺序不变，仅修正以下异常：
    - 时间倒序（某条 start < 前一条 start）→ 把 start 拉到前一条 end 之后
    - 与前一条重叠（start < 前一条 end + gap）→ 把 start 拉到前一条 end + gap
    - 超长字幕（duration > max_duration_us）→ 截断到合理边界
    - end < start → end = start + 0.3s

    不做全局排序，避免把原始正确的字幕语义顺序打乱。
    """
    if not cues:
        return cues

    fixed = []
    prev_end = -gap_us
    for start, end, text in cues:
        if end < start:
            end = start + 300_000  # 0.3s 兜底
        # 时间倒序或重叠 → 拉到前一条之后
        if start < prev_end + gap_us:
            start = prev_end + gap_us
            if start >= end:
                end = start + 300_000
        # 超长字幕截断：如果 duration 超过阈值，截断到 max
        if end - start > max_duration_us:
            end = start + max_duration_us
        fixed.append((start, end, text))
        prev_end = end
    return fixed


def fmt_time(us):
    ms = int(round(us / 1000.0))
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"


def build_draft(videos, subs, draft_folder, name):
    """构建草稿，按 SUB_LANES 把每条 srt 分到对应轨道，每条轨道独立 import_srt。

    subs: {num: [srt_path, ...]}  collect_dir 的原始输出，每条编号可能有 ≥1 个 srt。
    向后兼容：只有一条 lane 匹配时轨道名就是 SUB_DEFAULT_TRACK，行为与旧版完全一致。
    """
    Path(draft_folder).mkdir(parents=True, exist_ok=True)
    folder = draft.DraftFolder(str(draft_folder))

    # 为每条视频匹配字幕（按 lane 分组）
    pairs = []
    for num in sorted(videos, key=int):
        if num not in subs:
            continue
        video_path = prefer(videos[num], VIDEO_HINTS)
        # 把该编号的所有 srt 按 lane 分组
        # subs[num] 里每项可能是 str(path) 或 (lane_name, path) 两种
        lane_groups = {}
        for item in subs[num]:
            if isinstance(item, tuple):
                lane, srt = item[0], item[1]
            else:
                srt = item
                lane = match_lane(srt, SUB_LANES)
            if lane:
                lane_groups.setdefault(lane, []).append(srt)
        # 无匹配 lane 时 fallback 到旧行为（全部归入 subtitle）
        if not lane_groups and subs[num]:
            lane_groups[SUB_DEFAULT_TRACK] = [i[1] if isinstance(i, tuple) else i
                                               for i in subs[num]]
        pairs.append((num, video_path, lane_groups))

    if not pairs:
        return {"ok": False, "error": "没有找到编号匹配的视频/字幕对", "clips": []}

    first = draft.VideoMaterial(pairs[0][1])
    script = folder.create_draft(sanitize(name), first.width or 1080,
                                 first.height or 1920, allow_replace=True)
    script.append_tracks([draft.TrackSpec(TrackType.video, "video")])

    cursor = 0
    clips = []
    # 每条轨道独立收集 cues
    track_entries = {}  # {track_name: [(start, end, text), ...]}
    for num, video, lane_groups in pairs:
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

        per_episode_subs = {}
        total_kept = 0
        total_dropped = 0
        for lane_name, paths in lane_groups.items():
            srt = prefer(paths, [])  # 同 lane 内取第一条
            cues = load_srt_cues(srt)
            kept = 0
            for start, end, text in cues:
                start = max(start, 0)
                end = min(end, duration)
                if start >= duration or end <= start:
                    continue
                track_entries.setdefault(lane_name, []).append((cursor + start, cursor + end, text))
                kept += 1
            total_kept += kept
            total_dropped += len(cues) - kept
            per_episode_subs[lane_name] = os.path.basename(srt)

        clips.append({"number": num, "ok": True, "video": os.path.basename(video),
                      "srt_files": per_episode_subs, "start": cursor, "duration": duration,
                      "cues": total_kept, "dropped": total_dropped})
        cursor += duration

    # 每条轨道独立生成临时 SRT 并 import 到独立文本轨
    for track_name, entries in track_entries.items():
        if not entries:
            continue
        entries.sort(key=lambda item: item[0])
        tmp_path = None
        prev_end = 0
        seq = 0
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
            script.import_srt(tmp_path, track_name)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)

    script.save()

    # 写入分集清单（manifest），tracks 字段记录所有被导入的轨道名
    manifest = {
        "tool": "subtitle-toolbox",
        "name": sanitize(name),
        "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "duration": cursor,
        "tracks": sorted(track_entries.keys()),
        "episodes": [
            {"number": c["number"], "video": c.get("video", ""),
             "srt_files": c.get("srt_files", {}),
             "start": c["start"], "duration": c["duration"]}
            for c in clips if c["ok"]
        ],
    }
    try:
        manifest_path = Path(draft_folder) / sanitize(name) / "_toolbox_manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # manifest 写失败不影响草稿本身

    total_cues = sum(len(v) for v in track_entries.values())
    return {"ok": any(c["ok"] for c in clips), "name": sanitize(name),
            "clips": clips, "cues": total_cues, "duration": cursor}


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


def generate(mode, uploads, video_dir, subtitle_dir, draft_folder, name_prefix,
             subtitle_dir_en="", subtitle_dir_zh=""):
    """生成剪映草稿。

    subtitle_dir_en / subtitle_dir_zh: 显式指定英文/中文字幕文件夹，强制归入对应轨道。
        空字符串则忽略，改用 subtitle_dir + match_lane 模糊匹配。
    """
    explicit_en = subtitle_dir_en.strip().strip('"')
    explicit_zh = subtitle_dir_zh.strip().strip('"')
    only_explicit = bool(explicit_en or explicit_zh) and not subtitle_dir.strip()

    if mode == "path":
        vd = Path(video_dir.strip().strip('"'))
        sd = Path(subtitle_dir.strip().strip('"')) if subtitle_dir.strip() else None
        if not vd.is_dir():
            return {"error": "视频目录不存在：" + str(vd)}
        if sd is None and not (explicit_en or explicit_zh):
            return {"error": "请填写字幕目录，或显式指定英文/中文字幕文件夹"}
        if sd is not None and not sd.is_dir():
            return {"error": "字幕目录不存在：" + str(sd)}
        # 验证显式轨目录
        en_dir = Path(explicit_en) if explicit_en else None
        zh_dir = Path(explicit_zh) if explicit_zh else None
        if en_dir is not None and not en_dir.is_dir():
            return {"error": "英文字幕目录不存在：" + str(en_dir)}
        if zh_dir is not None and not zh_dir.is_dir():
            return {"error": "中文字幕目录不存在：" + str(zh_dir)}
    else:
        session = CACHE_DIR / uuid.uuid4().hex[:8]
        session.mkdir(parents=True, exist_ok=True)
        # uploads 支持两种格式：
        #   旧: (rel, fileobj) — 全部归入 session 根目录
        #   新: (group, rel, fileobj) — group 是 video/subtitle/subtitle_en/subtitle_zh
        # 新格式下不同 group 分别存到 session 下对应子目录，模拟显式轨
        videos, subs = {}, {}
        def _put(group, rel, fileobj):
            subdir = {"video": "video",
                      "subtitle": "subtitle",
                      "subtitle_en": "subtitle_en",
                      "subtitle_zh": "subtitle_zh"}.get(group, "")
            dest = session / subdir / safe_rel(rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as fh:
                shutil.copyfileobj(fileobj, fh)
        for item in uploads:
            if len(item) == 3:
                group, rel, fileobj = item
                _put(group, rel, fileobj)
            else:
                rel, fileobj = item
                _put("video", rel, fileobj)  # 默认归 video（旧行为兼容）
        # 新格式：按 group 扫描对应子目录
        vd = session / "video"
        sd = session / "subtitle" if (session / "subtitle").is_dir() else None
        en_dir = session / "subtitle_en" if (session / "subtitle_en").is_dir() else None
        zh_dir = session / "subtitle_zh" if (session / "subtitle_zh").is_dir() else None
        # 兼容旧格式：如果没有任何 group 子目录（全部文件在 session 根下），
        # 回退到 vd = sd = session 的旧行为
        if not vd.is_dir() and not (session / "subtitle").is_dir() \
                and not en_dir and not zh_dir:
            vd = sd = session
            en_dir = zh_dir = None

    # 扫描所有目录收集视频 + 字幕
    dirs = [str(vd)]
    if sd is not None:
        dirs.append(str(sd))
    if en_dir is not None:
        dirs.append(str(en_dir))
    if zh_dir is not None:
        dirs.append(str(zh_dir))
    videos, subs = {}, {}
    for d in dirs:
        v, s = collect_dir(d)
        merge(videos, v)
        merge(subs, s)

    # 显式轨：从 subs 里挑出对应编号的条目，标记为带 lane 的 tuple
    if en_dir is not None or zh_dir is not None:
        for num, paths in list(subs.items()):
            tagged = []
            remaining = []
            for p in paths:
                low_p = p.replace("\\", "/").lower()
                if en_dir is not None and str(en_dir).lower().replace("\\", "/") in low_p:
                    tagged.append(("subtitle_en", p))
                elif zh_dir is not None and str(zh_dir).lower().replace("\\", "/") in low_p:
                    tagged.append(("subtitle_zh", p))
                else:
                    remaining.append(p)
            if tagged:
                subs[num] = remaining + tagged

    # 平铺目录兜底：某编号同时有 .en. 后缀和裸数字 .srt 时，裸数字归 subtitle_zh
    # （用户场景：双轨\1.en.srt + 双轨\1.srt → 英文 + 中文）
    for num, items in subs.items():
        en_exist = any(isinstance(i, tuple) and i[0] == "subtitle_en"
                       or (isinstance(i, str) and ".en." in Path(i).name.lower())
                       for i in items)
        if not en_exist:
            continue
        new_items = []
        for item in items:
            if isinstance(item, tuple):
                new_items.append(item)
                continue
            low_name = Path(item).name.lower()
            if re.fullmatch(r"\d+\.srt", low_name):
                new_items.append(("subtitle_zh", item))
            else:
                new_items.append(item)
        subs[num] = new_items

    name = default_name(vd, sd, name_prefix, mode)
    result = build_draft(videos, subs, draft_folder or DEFAULT_DRAFT_FOLDER, name)
    result["draft_folder"] = str(draft_folder or DEFAULT_DRAFT_FOLDER)
    return result


# ============================ 字幕反拆分导出 ============================

MANIFEST_NAME = "_toolbox_manifest.json"


def list_manifests(draft_folder):
    """扫描草稿目录下所有本工具生成的分集清单。

    返回 [{name, folder, created, episodes, duration}]，按生成时间倒序。
    目录无效时抛 ValueError。
    """
    root = Path(draft_folder)
    if not root.is_dir():
        raise ValueError(f"草稿目录不存在：{draft_folder}")

    found = []
    for p in root.glob(f"*/{MANIFEST_NAME}"):
        try:
            data = json.loads(p.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        eps = data.get("episodes") or []
        found.append({
            "name": data.get("name") or p.parent.name,
            "folder": p.parent.name,
            "created": data.get("created", ""),
            "episodes": len(eps),
            "duration": data.get("duration", 0),
        })
    found.sort(key=lambda x: x["created"], reverse=True)
    return found


def split_export(srt_text, manifest, out_dir, force=False):
    """把剪映导出的合并 SRT 按 manifest 分集边界拆回每集一个 SRT。

    多轨 manifest（含 tracks 字段）：默认导出为一条 SRT（把所有轨合并回单轨），
    每条集文件不带轨后缀；这是剪映导出只会导出一条合并字幕轨的现实约束。
    如需分轨导出，传 track_filter=["subtitle_en"] 只导出指定轨（预留接口）。

    向后兼容：旧单轨 manifest（只有 srt 字段）照常工作。

    返回结果 dict；需要覆盖确认时返回 {"confirm_needed": True, "existing": [...]}。
    """
    episodes = [e for e in (manifest.get("episodes") or []) if e.get("duration")]
    if not episodes:
        raise ValueError("清单中没有可用的分集信息（episodes 为空）")
    episodes.sort(key=lambda e: e["start"])

    out = Path(out_dir)
    targets = {}
    for e in episodes:
        fname = re.sub(r'[\\/:*?"<>|]', "_", str(e["number"]))
        targets[e["number"]] = out / f"{fname}.srt"

    existing = sorted(str(p) for p in targets.values() if p.exists())
    if existing and not force:
        return {"confirm_needed": True, "existing": existing}

    out.mkdir(parents=True, exist_ok=True)

    cues = parse_srt_text(srt_text)
    buckets = {e["number"]: [] for e in episodes}
    dropped = []
    for start, end, text in cues:
        ep = next((e for e in episodes
                   if e["start"] <= start < e["start"] + e["duration"]), None)
        if ep is None:
            dropped.append((start, end))
            continue
        s = start - ep["start"]
        t = min(end, ep["start"] + ep["duration"]) - ep["start"]
        if t <= s:
            dropped.append((start, end))
            continue
        buckets[ep["number"]].append((s, t, text))

    report = []
    for e in episodes:
        rows = sorted(buckets[e["number"]])
        path = targets[e["number"]]
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            for i, (s, t, text) in enumerate(rows, 1):
                fh.write(f"{i}\n{fmt_time(s)} --> {fmt_time(t)}\n{text}\n\n")
        report.append({"number": e["number"], "cues": len(rows), "file": path.name})

    tracks = manifest.get("tracks") or []
    return {"output_dir": str(out), "episodes": report,
            "tracks": tracks,
            "total_cues": len(cues), "dropped": len(dropped),
            "dropped_samples": [f"{fmt_time(s)} → {fmt_time(t)}"
                                for s, t in dropped[:5]]}
