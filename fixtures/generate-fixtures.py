#!/usr/bin/env python3
"""Generate REAL Mibera fixtures for the freeside-inventory prototype.
Reads the actual codex; emits both fixtures with consistent token IDs,
preserving the self-contained test invariants (0x111..1 owns >=12, >=5 holders,
two pinned grail IDs, max block 9123456, totalSupply 10000, real contract)."""
import json

DATA = "/Users/zksoju/Documents/GitHub/mibera-codex/_codex/data"
MOD = "/Users/zksoju/Documents/GitHub/loa-freeside-spiral/packages/services/inventory/fixtures"
CONTRACT = "0x6666397DFe9a8c469BF65dc744CB1C733416c420"
COLLKEY, CHAIN = "mibera", 80094
MAXBLOCK = 9123456

# --- load real codex ---
miberas = {}
with open(f"{DATA}/miberas.jsonl") as f:
    for ln in f:
        ln = ln.strip()
        if ln:
            r = json.loads(ln); miberas[r["id"]] = r
with open(f"{DATA}/mibera-image-urls.json") as f:
    img = json.load(f)
grails_all = []
with open(f"{DATA}/grails.jsonl") as f:
    for ln in f:
        ln = ln.strip()
        if ln: grails_all.append(json.loads(ln))

# --- choose token ids: 1..50 generative + 5 real grail ids ---
grail_sel = grails_all[:5]                      # ids 2769,6805,4803,876,9503
grail_ids = [g["id"] for g in grail_sel]
gen_ids = list(range(1, 51))
all_ids = gen_ids + grail_ids                   # 55 ids

# --- ownership: 0x111..1 gets >=12; >=5 distinct holders ---
def addr(n): return "0x" + str(n) * 40
# 5 distinct holders; grails placed to match test addresses:
# 0x111..1 owns 12 generative (ADDR_WITH_MANY); 0x222..2 holds grail 2769
# (ADDR_WITH_GRAIL); 0x333..3 holds grail 876 (ADDR_WITH_GRAIL_2).
owners = {}
for i in range(1, 13):  owners[i] = addr(1)
for i in range(13, 20): owners[i] = addr(2)
for i in range(20, 30): owners[i] = addr(3)
for i in range(30, 41): owners[i] = addr(4)
for i in range(41, 51): owners[i] = addr(5)
owners[2769] = addr(2)
owners[876]  = addr(3)
owners[6805] = addr(4)
owners[4803] = addr(5)
owners[9503] = addr(5)

# --- sonar fixture ---
sonar_tokens, blk = [], 9000000
for idx, i in enumerate(all_ids):
    b = MAXBLOCK if idx == 0 else blk + idx * 137
    sonar_tokens.append({"collectionKey": COLLKEY, "chainId": CHAIN,
                         "contractAddress": CONTRACT, "tokenId": str(i),
                         "owner": owners[i], "blockNumber": b})
holder_counts = {}
for i in all_ids: holder_counts[owners[i]] = holder_counts.get(owners[i], 0) + 1
tracked = [{"collectionKey": COLLKEY, "chainId": CHAIN, "contractAddress": CONTRACT,
            "address": a, "tokenCount": c, "blockNumber": MAXBLOCK}
           for a, c in holder_counts.items()]
sonar = {"trackedHolders": tracked, "tokens": sonar_tokens}

# --- codex fixture (real records, drop the constant "type" key) ---
codex_tokens = [{k: v for k, v in miberas[i].items() if k != "type"} for i in all_ids]
codex_grails = [{"id": g["id"], "name": g["name"], "description": g["description"]} for g in grail_sel]
image_urls = {str(i): img[str(i)] for i in all_ids if str(i) in img}
codex = {"tokens": codex_tokens, "grails": codex_grails, "imageUrls": image_urls,
         "collection": {"contractAddress": CONTRACT, "name": "Mibera",
                        "symbol": "MIBERA", "totalSupply": 10000}}

with open(f"{MOD}/sonar-trackedholders.json", "w") as f:
    json.dump(sonar, f, indent=2)
with open(f"{MOD}/codex-tokens.json", "w") as f:
    json.dump(codex, f, indent=2, ensure_ascii=False)

print(f"sonar: {len(tracked)} holders, {len(sonar_tokens)} token rows, maxblock={MAXBLOCK}")
print(f"codex: {len(codex_tokens)} tokens, {len(codex_grails)} grails, {len(image_urls)} imageUrls")
print(f"grail ids (pin two in tests): {grail_ids}")
print(f"0x111..1 owns: {holder_counts[addr(1)]}; distinct holders: {len(holder_counts)}")
print(f"real token fields: {[k for k in codex_tokens[0].keys()]}")
miss = [str(i) for i in all_ids if str(i) not in img]
print(f"missing image urls: {miss if miss else 'none'}")