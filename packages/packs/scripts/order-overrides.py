"""Write a pack's routes/00-overrides.json so it keeps every literal generated route working.

00-overrides.json sorts before 10-generated.json, so a stateful override such as
GET /v1/customers/:customer would capture GET /v1/customers/search. Any generated
route with a literal segment where an override has a param (same method, same
number of segments) is copied ahead of the overrides, so it keeps answering.

Usage: python3 order-overrides.py <pack dir> <overrides.json written by the caller>
"""
import json, sys

pack_dir, overrides_path = sys.argv[1], sys.argv[2]
overrides = json.load(open(overrides_path))
generated = json.load(open(f"{pack_dir}/routes/10-generated.json"))

def shadows(pattern, path):
    p, x = pattern.strip("/").split("/"), path.strip("/").split("/")
    if len(p) != len(x):
        return False
    literal_under_param = False
    for a, b in zip(p, x):
        if a.startswith(":"):
            literal_under_param |= not b.startswith(":")
        elif a != b:
            return False
    return literal_under_param

ahead = []
for g in generated:
    for o in overrides:
        if o["match"]["method"] == g["match"]["method"] and shadows(o["match"]["path"], g["match"]["path"]):
            if g not in ahead:
                ahead.append(g)
ahead_ids = {g["id"] for g in ahead}
copies = [{**g, "id": g["id"] + ":literal", "note": "Copied ahead of the stateful overrides so this literal path keeps answering."} for g in ahead]
json.dump(copies + overrides, open(f"{pack_dir}/routes/00-overrides.json", "w"), indent=2)
open(f"{pack_dir}/routes/00-overrides.json", "a").write("\n")
print(f"{pack_dir}: {len(copies)} literal routes kept ahead of {len(overrides)} overrides")
