from pathlib import Path


def caption_file_contract(frame_paths):
    if not isinstance(frame_paths, list) or not frame_paths:
        raise ValueError("invalid_frame_file_list")
    names = []
    for item in frame_paths:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("invalid_frame_file_list")
        name = Path(item).name
        if name in {"", ".", ".."}:
            raise ValueError("invalid_frame_file_list")
        names.append(name)
    return {
        "file_names": names,
        "frame_count": len(names),
    }
