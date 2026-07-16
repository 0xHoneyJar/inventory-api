import { describe, it, expect } from "vitest";
import { Effect, Either, Schema } from "effect";
import {
  EquivalenceBasis,
  decodeCollectionDeploymentRef,
  digestVersioned,
  makeCollectionDeploymentRef,
  makeCollectionIdentity,
  type CollectionDeploymentRef,
} from "@freeside/collection-protocol";
import {
  lookupExactDeployment,
  registryDeploymentRefsOf,
  EXACT_ENRICHMENT_CONTRACT_VERSION,
  SOLANA_MAINNET_NETWORK_REFERENCE,
  REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN,
  REGISTRY_EQUIVALENCE_ASSERTION_VERSION,
  type ExactEnrichmentHit,
} from "../src/exact-enrichment.js";
import {
  listCollectionRegistry,
  resolveCollectionRouteParam,
  resolveMetadataStrategy,
  MIBERA_CONTRACT,
  MIBERA_CHAIN_ID,
  MST_CONTRACT,
  AZUKI_CONTRACT,
  AZUKI_CHAIN_ID,
  PYTHIANS_COLLECTION_MINT,
  MAD_LADS_COLLECTION_MINT,
  MAD_LADS_COLLECTION_KEY,
  FRACTURED_ADDRESSES,
} from "../src/collection-registry.js";
import { toChecksumAddress } from "../src/address.js";
import { ValidationError } from "../src/errors.js";

/** CR-001 CollectionDeploymentInput wire shape for an eip155 deployment. */
function evmInput(chainId: number | string, address: string) {
  return {
    schema_version: 1,
    network: {
      schema_version: 1,
      network_namespace: "eip155",
      network_reference: String(chainId),
    },
    address,
  };
}

/** CR-001 CollectionDeploymentInput wire shape for a solana deployment. */
function solanaInput(address: string, cluster = SOLANA_MAINNET_NETWORK_REFERENCE) {
  return {
    schema_version: 1,
    network: {
      schema_version: 1,
      network_namespace: "solana",
      network_reference: cluster,
    },
    address,
  };
}

/** Mint a verified full CollectionDeploymentRef through the protocol package. */
function mintRef(input: unknown): CollectionDeploymentRef {
  return Effect.runSync(makeCollectionDeploymentRef(input));
}

const decodeBasisStrict = Schema.decodeUnknownEither(EquivalenceBasis, {
  errors: "all",
  onExcessProperty: "error",
});

const digestKeyOf = (ref: CollectionDeploymentRef) =>
  `${ref.deployment_id.domain}:${ref.deployment_id.major_version}:${ref.deployment_id.digest}`;

function expectHit(result: ReturnType<typeof lookupExactDeployment>): ExactEnrichmentHit {
  expect(result.found).toBe(true);
  return result as ExactEnrichmentHit;
}

/** Every deployment input a registry row asserts, in test-helper form. */
function rowInputs(entry: ReturnType<typeof listCollectionRegistry>[number]) {
  return entry.chain === "evm"
    ? (entry.evmContracts ?? []).map((address) => evmInput(entry.chainId, address))
    : [solanaInput(entry.svmCollectionMint!)];
}

describe("exact-enrichment (CR-105): lookup accepts the shared deployment reference", () => {
  it("resolves Mibera by exact chain-qualified deployment input", () => {
    const hit = expectHit(
      lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT))
    );
    expect(hit.contract_version).toBe(EXACT_ENRICHMENT_CONTRACT_VERSION);
    expect(hit.deployment.network.network_namespace).toBe("eip155");
    expect(hit.deployment.network.network_reference).toBe("80094");
    expect(hit.deployment.address).toBe(MIBERA_CONTRACT); // EIP-55 display form
    expect(hit.deployment.normalized_address).toBe(MIBERA_CONTRACT.toLowerCase());
    // The returned deployment is a full CR-001 ref whose digest the protocol
    // package itself re-verifies (recompute + compare, not shape-only).
    expect(
      Either.isRight(
        Effect.runSync(Effect.either(decodeCollectionDeploymentRef(hit.deployment)))
      )
    ).toBe(true);
    expect(hit.collection.collection_key).toBe("mibera");
    expect(hit.collection.name).toBe("Mibera");
    expect(hit.collection.symbol).toBe("MIBERA");
    expect(hit.collection.aliases).toContain("mibera");
    expect(hit.collection.total_supply).toBe(10_000);
    expect(hit.collection.enabled).toBe(true);
    expect(hit.collection.metadata_strategy).toEqual({ kind: "sovereign-world" });
    expect(hit.collection.rehost_policy).toBe("mirror");
    // Mibera publishes no imageHost — the key is OMITTED, never null.
    expect("image_host" in hit.collection).toBe(false);
    expect(hit.equivalence.basis).toEqual({
      schema_version: 1,
      kind: "single_deployment",
    });
    expect(hit.equivalence.deployments).toEqual([hit.deployment]);
    expect("assertion_ref" in hit.equivalence).toBe(false);
  });

  it("compares EVM addresses case-insensitively while returning checksum display form", () => {
    for (const variant of [
      MIBERA_CONTRACT.toLowerCase(),
      MIBERA_CONTRACT.toUpperCase().replace(/^0X/, "0x"),
    ]) {
      const hit = expectHit(lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, variant)));
      expect(hit.collection.collection_key).toBe("mibera");
      expect(hit.deployment.address).toBe(MIBERA_CONTRACT);
      expect(hit.deployment.normalized_address).toBe(MIBERA_CONTRACT.toLowerCase());
    }
  });

  it("returns checksum display form even for a row stored lowercase at rest (MST)", () => {
    // MST_CONTRACT is all-lowercase in the registry source; identity is minted
    // over the normalized form, display is canonicalized at index build.
    const hit = expectHit(lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, MST_CONTRACT)));
    expect(hit.collection.collection_key).toBe("mst");
    expect(hit.deployment.address).toBe(toChecksumAddress(MST_CONTRACT));
    expect(hit.deployment.normalized_address).toBe(MST_CONTRACT.toLowerCase());
  });
});

describe("exact-enrichment (CR-105): full CollectionDeploymentRef queries are digest-verified", () => {
  it("accepts a protocol-minted full ref and returns the same verified deployment identity", () => {
    const full = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const hit = expectHit(lookupExactDeployment(full));
    expect(hit.collection.collection_key).toBe("mibera");
    // Same canonical identity digest, registry display form.
    expect(hit.deployment.deployment_id).toEqual(full.deployment_id);
    expect(hit.deployment).toEqual(full);
  });

  it("matches a lowercase-cased full ref to the same identity and restores display form", () => {
    const lower = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT.toLowerCase()));
    const hit = expectHit(lookupExactDeployment(lower));
    // deployment_id binds the normalized form, so the digest is identical...
    expect(hit.deployment.deployment_id).toEqual(lower.deployment_id);
    // ...while the result carries the registry's EIP-55 display form.
    expect(hit.deployment.address).toBe(MIBERA_CONTRACT);
  });

  it("accepts a protocol-minted Solana full ref", () => {
    const full = mintRef(solanaInput(PYTHIANS_COLLECTION_MINT));
    const hit = expectHit(lookupExactDeployment(full));
    expect(hit.collection.collection_key).toBe("pythians");
    expect(hit.deployment).toEqual(full);
  });

  it("returns { found: false } for a digest-verified ref of an UNREGISTERED deployment", () => {
    // Integrity-valid but unknown must be an honest miss, not an error and
    // never an alias guess.
    const unknown = mintRef(
      evmInput(MIBERA_CHAIN_ID, "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01")
    );
    expect(lookupExactDeployment(unknown)).toEqual({
      contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION,
      found: false,
    });
  });

  it("rejects a shape-valid but fabricated deployment_id digest", () => {
    const fake = {
      ...mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT)),
      deployment_id: {
        algorithm: "sha-256",
        domain: "collection.deployment",
        major_version: 1,
        digest: "a".repeat(64),
      },
    };
    expect(() => lookupExactDeployment(fake)).toThrow(ValidationError);
    expect(() => lookupExactDeployment(fake)).toThrow(
      /protocol-recomputed canonical digest/
    );
  });

  it("rejects a REAL protocol digest grafted from a different deployment", () => {
    // Strongest fake: valid shape, genuinely protocol-minted digest — just for
    // other material. Must fail integrity, never match either collection.
    const mibera = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const azuki = mintRef(evmInput(AZUKI_CHAIN_ID, AZUKI_CONTRACT));
    const grafted = { ...mibera, deployment_id: azuki.deployment_id };
    expect(() => lookupExactDeployment(grafted)).toThrow(ValidationError);
    expect(() => lookupExactDeployment(grafted)).toThrow(
      /refusing to treat an unverified digest/
    );
  });

  it("rejects a deployment_id outside the collection.deployment v1 digest domain", () => {
    const real = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const wrongDomain = {
      ...real,
      deployment_id: { ...real.deployment_id, domain: "collection.identity" },
    };
    expect(() => lookupExactDeployment(wrongDomain)).toThrow(ValidationError);
    const wrongMajor = {
      ...real,
      deployment_id: { ...real.deployment_id, major_version: 2 },
    };
    expect(() => lookupExactDeployment(wrongMajor)).toThrow(ValidationError);
  });

  it("rejects a full ref whose normalized_address contradicts the address", () => {
    const real = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    // Checksum-cased comparison form is not lowercase → refused.
    expect(() =>
      lookupExactDeployment({ ...real, normalized_address: MIBERA_CONTRACT })
    ).toThrow(ValidationError);
    // Lowercase form of a DIFFERENT address → refused (and could never match
    // the digest anyway).
    expect(() =>
      lookupExactDeployment({
        ...real,
        normalized_address: AZUKI_CONTRACT.toLowerCase(),
      })
    ).toThrow(ValidationError);
  });

  it("rejects excess properties on a full ref (strict CR-001 decode)", () => {
    const real = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    expect(() => lookupExactDeployment({ ...real, extra: true })).toThrow(
      ValidationError
    );
  });
});

describe("exact-enrichment (CR-105): hybrid/partial reference forms are unrepresentable", () => {
  it("rejects input + normalized_address without deployment_id (EVM)", () => {
    expect(() =>
      lookupExactDeployment({
        ...evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT),
        normalized_address: MIBERA_CONTRACT.toLowerCase(),
      })
    ).toThrow(ValidationError);
  });

  it("rejects input + normalized_address without deployment_id (Solana, even value-consistent)", () => {
    // The VALUE is exactly right — the FORM is still a hybrid and is refused.
    expect(() =>
      lookupExactDeployment({
        ...solanaInput(PYTHIANS_COLLECTION_MINT),
        normalized_address: PYTHIANS_COLLECTION_MINT,
      })
    ).toThrow(ValidationError);
  });

  it("rejects input + deployment_id without normalized_address, even with the REAL digest", () => {
    const real = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    expect(() =>
      lookupExactDeployment({
        ...evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT),
        deployment_id: real.deployment_id,
      })
    ).toThrow(ValidationError);
  });

  it("rejects cross-namespace confusion (eip155 network with base58 address and vice versa)", () => {
    expect(() =>
      lookupExactDeployment({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        address: PYTHIANS_COLLECTION_MINT,
      })
    ).toThrow(ValidationError);
    expect(() =>
      lookupExactDeployment(solanaInput(MIBERA_CONTRACT))
    ).toThrow(ValidationError);
  });
});

describe("exact-enrichment (CR-105): EVM proxy collection (Azuki)", () => {
  it("resolves Azuki on eip155:1 as a mechanically-proxy row", () => {
    const hit = expectHit(lookupExactDeployment(evmInput(AZUKI_CHAIN_ID, AZUKI_CONTRACT)));
    expect(hit.deployment.network.network_reference).toBe("1");
    expect(hit.collection.collection_key).toBe("azuki");
    expect(hit.collection.name).toBe("Azuki");
    expect(hit.collection.aliases).toEqual(["azuki"]);
    // Proxy pointer strategy, and the EFFECTIVE rights policy is concrete
    // ("proxy" from the omitted-field default) — never undefined.
    expect(hit.collection.metadata_strategy).toEqual({ kind: "tokenuri" });
    expect(hit.collection.rehost_policy).toBe("proxy");
    expect(hit.equivalence.basis).toEqual({
      schema_version: 1,
      kind: "single_deployment",
    });
  });

  it("misses Azuki's address on a different network (exactness is chain-qualified)", () => {
    const result = lookupExactDeployment(evmInput(8453, AZUKI_CONTRACT));
    expect(result).toEqual({
      contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION,
      found: false,
    });
  });

  it("keeps proxy and mirror mechanically distinct across every registered deployment", () => {
    for (const entry of listCollectionRegistry()) {
      for (const input of rowInputs(entry)) {
        const hit = expectHit(lookupExactDeployment(input));
        const mirrorHosted =
          hit.collection.metadata_strategy.kind === "sovereign" ||
          hit.collection.metadata_strategy.kind === "sovereign-world";
        expect(hit.collection.rehost_policy === "mirror").toBe(mirrorHosted);
      }
    }
  });
});

describe("exact-enrichment (CR-105): Solana proxy rows", () => {
  it("resolves Pythenians by collection mint with sonar-image proxy strategy and image host", () => {
    const hit = expectHit(lookupExactDeployment(solanaInput(PYTHIANS_COLLECTION_MINT)));
    expect(hit.deployment.network.network_namespace).toBe("solana");
    expect(hit.deployment.network.network_reference).toBe("mainnet-beta");
    expect(hit.deployment.address).toBe(PYTHIANS_COLLECTION_MINT); // verbatim, case-sensitive
    expect(hit.deployment.normalized_address).toBe(PYTHIANS_COLLECTION_MINT);
    expect(hit.collection.collection_key).toBe("pythians");
    expect(hit.collection.name).toBe("Pythenians");
    expect(hit.collection.metadata_strategy).toEqual({ kind: "sonar-image" });
    expect(hit.collection.rehost_policy).toBe("proxy");
    expect(hit.collection.image_host).toEqual(["ipfs.pythenians.xyz"]);
    expect(hit.equivalence.basis).toEqual({
      schema_version: 1,
      kind: "single_deployment",
    });
  });

  it("resolves Mad Lads by collection mint with sonar-image proxy strategy and image host", () => {
    const hit = expectHit(lookupExactDeployment(solanaInput(MAD_LADS_COLLECTION_MINT)));
    expect(hit.collection.collection_key).toBe(MAD_LADS_COLLECTION_KEY);
    expect(hit.collection.metadata_strategy).toEqual({ kind: "sonar-image" });
    expect(hit.collection.rehost_policy).toBe("proxy");
    expect(hit.collection.image_host).toEqual(["madlads.s3.us-west-2.amazonaws.com"]);
  });

  it("keys Solana rows on the cluster reference, not the legacy numeric 101", () => {
    // "101" is a syntactically valid cluster string — but no row keys on it,
    // because the contract does not impose one numeric chain-id shape per VM.
    const numeric = lookupExactDeployment(solanaInput(PYTHIANS_COLLECTION_MINT, "101"));
    expect(numeric.found).toBe(false);

    const canonical = lookupExactDeployment(solanaInput(PYTHIANS_COLLECTION_MINT));
    expect(expectHit(canonical).deployment.network.network_reference).toBe(
      SOLANA_MAINNET_NETWORK_REFERENCE
    );
  });

  it("never case-folds Solana keys: case-mangled mints are refused, not matched", () => {
    // Lowercasing changes the base58 VALUE. Both variants fail the protocol's
    // strict 32-byte public-key decode — each is refused as malformed input,
    // and neither can ever reach a case-folded registry hit.
    expect(() =>
      lookupExactDeployment(solanaInput(MAD_LADS_COLLECTION_MINT.toLowerCase()))
    ).toThrow(ValidationError);
    expect(() =>
      lookupExactDeployment(solanaInput(PYTHIANS_COLLECTION_MINT.toLowerCase()))
    ).toThrow(ValidationError);
  });
});

describe("exact-enrichment (CR-105): unknown exact deployment returns explicit empty", () => {
  it("returns { found: false } for an unregistered EVM deployment", () => {
    const result = lookupExactDeployment(
      evmInput(MIBERA_CHAIN_ID, "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01")
    );
    expect(result).toEqual({
      contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION,
      found: false,
    });
  });

  it("returns { found: false } for a valid but unregistered Solana mint", () => {
    const result = lookupExactDeployment(
      solanaInput("So11111111111111111111111111111111111111112")
    );
    expect(result).toEqual({
      contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION,
      found: false,
    });
  });

  it("misses a registered address queried on the wrong network", () => {
    expect(lookupExactDeployment(evmInput(1, MIBERA_CONTRACT)).found).toBe(false);
    expect(lookupExactDeployment(evmInput(80095, MIBERA_CONTRACT)).found).toBe(false);
  });

  it("cannot be reached by aliases: alias strings are not deployment references", () => {
    // These all resolve through the ROUTE index (resolveCollectionRouteParam);
    // the exact-deployment contract refuses them as malformed instead of
    // guessing an alias match.
    for (const alias of ["azuki", "mibera", "mad-lads", "pythians"]) {
      expect(() => lookupExactDeployment(evmInput(1, alias))).toThrow(ValidationError);
      expect(() => lookupExactDeployment(alias)).toThrow(ValidationError);
    }
  });

  it("makes address-only and numeric-chain-only identities unrepresentable", () => {
    // address-only (no network object)
    expect(() =>
      lookupExactDeployment({ schema_version: 1, address: MIBERA_CONTRACT })
    ).toThrow(ValidationError);
    // numeric-chain-only (bare chainId, no namespace)
    expect(() =>
      lookupExactDeployment({
        schema_version: 1,
        chainId: MIBERA_CHAIN_ID,
        address: MIBERA_CONTRACT,
      })
    ).toThrow(ValidationError);
    // numeric network_reference (must be the decimal STRING form)
    expect(() =>
      lookupExactDeployment({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: MIBERA_CHAIN_ID,
        },
        address: MIBERA_CONTRACT,
      })
    ).toThrow(ValidationError);
    // leading-zero and zero references are not canonical
    expect(() =>
      lookupExactDeployment(evmInput("080094", MIBERA_CONTRACT))
    ).toThrow(ValidationError);
    expect(() => lookupExactDeployment(evmInput("0", MIBERA_CONTRACT))).toThrow(
      ValidationError
    );
    // excess properties are refused (strict decode, CR-001 posture)
    expect(() =>
      lookupExactDeployment({
        ...evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT),
        extra: true,
      })
    ).toThrow(ValidationError);
  });
});

describe("exact-enrichment (CR-105): equivalence evidence is exact CR-001 EquivalenceBasis", () => {
  it("returns the registry basis for Fractures with a deterministic assertion digest", () => {
    const queried = FRACTURED_ADDRESSES[3];
    const hit = expectHit(lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, queried)));
    expect(hit.collection.collection_key).toBe("fractures");
    expect(hit.deployment.address).toBe(toChecksumAddress(queried));

    const equivalence = hit.equivalence;
    expect(equivalence.basis.kind).toBe("registry");
    if (equivalence.basis.kind !== "registry") throw new Error("unreachable");
    expect(equivalence.basis.schema_version).toBe(1);
    expect(equivalence.assertion_ref).toBe("inventory-registry:fractures");

    // The full curated deployment set, chain-qualified, includes the queried
    // deployment.
    expect(equivalence.deployments).toHaveLength(FRACTURED_ADDRESSES.length);
    const normalized = equivalence.deployments.map((d) => d.normalized_address);
    expect(new Set(normalized)).toEqual(
      new Set(FRACTURED_ADDRESSES.map((a) => a.toLowerCase()))
    );
    for (const deployment of equivalence.deployments) {
      expect(deployment.network.network_namespace).toBe("eip155");
      expect(deployment.network.network_reference).toBe("80094");
    }
    expect(normalized).toContain(queried.toLowerCase());

    // The assertion digest is DETERMINISTIC and re-derivable: recompute it
    // from the documented material (assertion source + reference + the sorted
    // deployment_id set) through the protocol package's canonical encoder.
    const recomputed = Effect.runSync(
      digestVersioned(
        REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN,
        REGISTRY_EQUIVALENCE_ASSERTION_VERSION,
        {
          source: "inventory_registry",
          source_reference: "inventory-registry:fractures",
          deployment_ids: equivalence.deployments.map((d) => d.deployment_id),
        }
      )
    );
    expect(equivalence.basis.assertion_digest).toEqual(recomputed);
  });

  it("resolves every fracture deployment to the same assertion digest", () => {
    const digests = new Set<string>();
    for (const address of FRACTURED_ADDRESSES) {
      const hit = expectHit(lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, address)));
      expect(hit.collection.collection_key).toBe("fractures");
      if (hit.equivalence.basis.kind !== "registry") {
        throw new Error("expected registry basis");
      }
      digests.add(hit.equivalence.basis.assertion_digest.digest);
    }
    expect(digests.size).toBe(1);
  });

  it("single-deployment rows carry the explicit single_deployment basis, never an inferred group", () => {
    for (const input of [
      evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT),
      evmInput(AZUKI_CHAIN_ID, AZUKI_CONTRACT),
      solanaInput(MAD_LADS_COLLECTION_MINT),
    ]) {
      const hit = expectHit(lookupExactDeployment(input));
      expect(hit.equivalence.basis).toEqual({
        schema_version: 1,
        kind: "single_deployment",
      });
      expect(hit.equivalence.deployments).toEqual([hit.deployment]);
      expect("assertion_ref" in hit.equivalence).toBe(false);
    }
  });

  it("every emitted basis strict-decodes through CR-001 and assembles a valid CR-001 identity", () => {
    for (const entry of listCollectionRegistry()) {
      const hit = expectHit(lookupExactDeployment(rowInputs(entry)[0]!));
      const { basis, deployments, assertion_ref } = hit.equivalence;

      // Exact CR-001 EquivalenceBasis (strict decode, excess rejected).
      expect(Either.isRight(decodeBasisStrict(basis))).toBe(true);

      // Registry claims exist ONLY for genuinely multi-deployment curated
      // evidence; single rows are single_deployment. assertion_ref presence
      // tracks the registry kind exactly (omit-not-null).
      if (deployments.length === 1) {
        expect(basis.kind).toBe("single_deployment");
        expect(assertion_ref).toBeUndefined();
      } else {
        expect(basis.kind).toBe("registry");
        expect(assertion_ref).toBe(`inventory-registry:${entry.collectionKey}`);
      }

      // Deployment set follows CR-001's canonical sorted-set rule.
      const keys = deployments.map(digestKeyOf);
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(keys.length);

      // Every deployment in the set is a digest-verified CR-001 ref.
      for (const deployment of deployments) {
        expect(
          Either.isRight(
            Effect.runSync(Effect.either(decodeCollectionDeploymentRef(deployment)))
          )
        ).toBe(true);
      }

      // The (deployments, basis) pair passes the protocol's own identity
      // assembly — the same validator CR-108 consumers will run.
      const identity = Effect.runSync(
        Effect.either(
          makeCollectionIdentity({
            schema_version: 1,
            deployments,
            equivalence_basis: basis,
          })
        )
      );
      expect(Either.isRight(identity)).toBe(true);
    }
  });
});

describe("exact-enrichment (CR-105): registry rows are CR-001-validated at index build, fail-closed", () => {
  // Hand-built rows exercise the refusal branches directly (same doctrine as
  // assertRehostPolicyInvariant) — the real registry is healthy, so these
  // branches never fire in the compatibility sweep.
  const baseRow = {
    id: MIBERA_CONTRACT,
    chain: "evm" as const,
    chainId: MIBERA_CHAIN_ID,
    collectionKey: "hand-built",
    worldSlug: "test",
    metadataSlug: null,
    name: "Hand Built",
    symbol: "HB",
    totalSupply: 1,
    aliases: ["hand-built"],
    metadataStrategy: { kind: "tokenuri" } as const,
    external: true,
    enabled: true,
    evmContracts: [MIBERA_CONTRACT],
  };

  it("validates real registry rows through the protocol package (all pass)", () => {
    for (const entry of listCollectionRegistry()) {
      const refs = registryDeploymentRefsOf(entry);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(
          Either.isRight(
            Effect.runSync(Effect.either(decodeCollectionDeploymentRef(ref)))
          )
        ).toBe(true);
      }
    }
  });

  it("refuses an EVM row whose chainId is not a positive safe integer", () => {
    expect(() => registryDeploymentRefsOf({ ...baseRow, chainId: 0 })).toThrow(
      /not a positive safe integer/
    );
    expect(() => registryDeploymentRefsOf({ ...baseRow, chainId: -1 })).toThrow(
      /not a positive safe integer/
    );
    // 2^53 + 1 stringifies to a silently-wrong but pattern-valid decimal —
    // must be refused BEFORE derivation, not laundered through.
    expect(() =>
      registryDeploymentRefsOf({ ...baseRow, chainId: 2 ** 53 + 1 })
    ).toThrow(/not a positive safe integer/);
  });

  it("refuses an EVM row with no registered contracts", () => {
    expect(() =>
      registryDeploymentRefsOf({ ...baseRow, evmContracts: [] })
    ).toThrow(/no exact deployment identity/);
  });

  it("refuses an SVM row with no collection mint", () => {
    expect(() =>
      registryDeploymentRefsOf({
        ...baseRow,
        chain: "svm",
        chainId: 101,
        evmContracts: undefined,
      })
    ).toThrow(/no exact deployment identity/);
  });

  it("refuses an SVM row whose chainId maps to no known cluster (never guesses)", () => {
    expect(() =>
      registryDeploymentRefsOf({
        ...baseRow,
        chain: "svm",
        chainId: 102,
        evmContracts: undefined,
        svmCollectionMint: PYTHIANS_COLLECTION_MINT,
      })
    ).toThrow(/Refusing to guess a network reference/);
  });

  it("refuses an SVM row whose mint fails the strict 32-byte public-key check", () => {
    expect(() =>
      registryDeploymentRefsOf({
        ...baseRow,
        chain: "svm",
        chainId: 101,
        evmContracts: undefined,
        // Case-mangled: valid charset shape, wrong byte magnitude.
        svmCollectionMint: MAD_LADS_COLLECTION_MINT.toLowerCase(),
      })
    ).toThrow(/fails CR-001 deployment validation/);
  });
});

describe("exact-enrichment (CR-105): existing EVM and SVM rows stay compatible", () => {
  it("reaches every registry row through every one of its exact deployments", () => {
    for (const entry of listCollectionRegistry()) {
      const inputs = rowInputs(entry);
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        const hit = expectHit(lookupExactDeployment(input));
        expect(hit.collection.collection_key).toBe(entry.collectionKey);
        expect(hit.collection.name).toBe(entry.name);
        expect(hit.collection.aliases).toEqual(entry.aliases);
        expect(hit.collection.metadata_strategy).toEqual(entry.metadataStrategy);
        // image_host follows the omit-not-null wire rule.
        if ("image_host" in hit.collection) {
          expect(Array.isArray(hit.collection.image_host)).toBe(true);
          expect(hit.collection.image_host!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("derives per-VM network references without one shared numeric chain-id shape", () => {
    for (const entry of listCollectionRegistry()) {
      if (entry.chain === "evm") {
        const hit = expectHit(
          lookupExactDeployment(evmInput(entry.chainId, entry.evmContracts![0]!))
        );
        expect(hit.deployment.network.network_namespace).toBe("eip155");
        expect(hit.deployment.network.network_reference).toBe(String(entry.chainId));
      } else {
        const hit = expectHit(
          lookupExactDeployment(solanaInput(entry.svmCollectionMint!))
        );
        expect(hit.deployment.network.network_namespace).toBe("solana");
        expect(hit.deployment.network.network_reference).toBe(
          SOLANA_MAINNET_NETWORK_REFERENCE
        );
      }
    }
  });
});

describe("exact-enrichment (CR-105): results are an immutable boundary — caller mutation cannot corrupt the index", () => {
  /**
   * An adversarial caller ignores the compile-time `readonly` contract; model
   * that honestly by stripping types and mutating raw runtime values.
   */
  const raw = (value: unknown): any => value;

  const pristine = (input: unknown) => expectHit(lookupExactDeployment(input));

  /**
   * Baselines are DETACHED test-side (structuredClone) before any vandalism.
   * Under a regressed implementation that aliases module state into results,
   * an un-detached baseline would be corrupted together with the index and
   * the pristine-comparison would pass vacuously; the detached copy keeps the
   * regression visible.
   */
  const detachedBaseline = (input: unknown) => structuredClone(pristine(input));

  const expectRefStrictDecodes = (ref: unknown) => {
    expect(
      Either.isRight(Effect.runSync(Effect.either(decodeCollectionDeploymentRef(ref))))
    ).toBe(true);
  };

  /** Full mutation storm over everything a hit exposes. */
  function vandalize(hit: ReturnType<typeof pristine>): void {
    const h = raw(hit);
    h.contract_version = "inventory.exact-enrichment.v666";
    h.found = false;
    h.deployment.address = "0x0000000000000000000000000000000000000000";
    h.deployment.normalized_address = "corrupt";
    h.deployment.network.network_namespace = "evil";
    h.deployment.network.network_reference = "0";
    h.deployment.deployment_id.digest = "f".repeat(64);
    h.deployment.deployment_id.domain = "evil.domain";
    h.deployment.deployment_id.major_version = 999;
    h.collection.collection_key = "evil";
    h.collection.name = "Evil";
    h.collection.symbol = "EVIL";
    h.collection.total_supply = 0;
    h.collection.enabled = !h.collection.enabled;
    h.collection.rehost_policy = "excluded";
    h.collection.aliases[0] = "evil-alias";
    h.collection.aliases.push("more-evil");
    h.collection.metadata_strategy.kind = "unresolved";
    h.collection.metadata_strategy.reason = "vandalized";
    h.collection.metadata_strategy.slug = "vandalized";
    if (h.collection.image_host) {
      h.collection.image_host[0] = "evil.example";
      h.collection.image_host.push("more.evil.example");
    } else {
      h.collection.image_host = ["injected.evil.example"];
    }
    const basis = h.equivalence.basis;
    basis.schema_version = 999;
    if (basis.assertion_digest) {
      basis.assertion_digest.digest = "0".repeat(64);
      basis.assertion_digest.domain = "evil";
      basis.assertion_digest.major_version = 999;
    } else {
      basis.assertion_digest = { fake: true };
    }
    basis.kind = basis.kind === "registry" ? "single_deployment" : "registry";
    h.equivalence.assertion_ref = "inventory-registry:evil";
    if (h.equivalence.deployments[0]) {
      h.equivalence.deployments[0].deployment_id.digest = "e".repeat(64);
      h.equivalence.deployments[0].network.network_reference = "corrupt";
    }
    h.equivalence.deployments.pop();
    h.equivalence.deployments.push({ fake: true });
    delete h.deployment.deployment_id;
  }

  it("serves each lookup as a fresh value — no object identity is shared across results", () => {
    const first = pristine(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const second = pristine(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    expect(second).toStrictEqual(first);
    expect(second).not.toBe(first);
    expect(second.deployment).not.toBe(first.deployment);
    expect(second.deployment.network).not.toBe(first.deployment.network);
    expect(second.deployment.deployment_id).not.toBe(first.deployment.deployment_id);
    expect(second.collection).not.toBe(first.collection);
    expect(second.collection.aliases).not.toBe(first.collection.aliases);
    expect(second.collection.metadata_strategy).not.toBe(
      first.collection.metadata_strategy
    );
    expect(second.equivalence).not.toBe(first.equivalence);
    expect(second.equivalence.deployments).not.toBe(first.equivalence.deployments);
    expect(second.equivalence.deployments[0]).not.toBe(
      first.equivalence.deployments[0]
    );

    // Multi-deployment evidence and optional fields are fresh per call too.
    const fracA = pristine(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]));
    const fracB = pristine(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]));
    if (fracA.equivalence.basis.kind !== "registry") throw new Error("unreachable");
    if (fracB.equivalence.basis.kind !== "registry") throw new Error("unreachable");
    expect(fracB.equivalence.basis.assertion_digest).not.toBe(
      fracA.equivalence.basis.assertion_digest
    );

    const pythA = pristine(solanaInput(PYTHIANS_COLLECTION_MINT));
    const pythB = pristine(solanaInput(PYTHIANS_COLLECTION_MINT));
    expect(pythB.collection.image_host).not.toBe(pythA.collection.image_host);
  });

  it("results are caller-owned plain copies — mutation attempts succeed on the copy, never throw", () => {
    const hit = pristine(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    // The boundary is clone-on-read, not frozen responses: the caller owns the
    // returned value outright and may post-process it freely.
    expect(() => vandalize(hit)).not.toThrow();
    expect(hit.collection.name).toBe("Evil");
    expect(raw(hit).collection.aliases).toContain("more-evil");
  });

  it("mutating deployment identity fields (digest, network, address) cannot poison later lookups", () => {
    const input = evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT);
    const baseline = detachedBaseline(input);

    const victim = pristine(input);
    raw(victim).deployment.deployment_id.digest = "f".repeat(64);
    raw(victim).deployment.deployment_id.domain = "evil.domain";
    raw(victim).deployment.deployment_id.major_version = 999;
    raw(victim).deployment.deployment_id.algorithm = "evil-hash";
    raw(victim).deployment.network.network_reference = "1";
    raw(victim).deployment.network.network_namespace = "solana";
    raw(victim).deployment.address = AZUKI_CONTRACT;
    raw(victim).deployment.normalized_address = AZUKI_CONTRACT.toLowerCase();
    delete raw(victim).deployment.deployment_id;

    const again = pristine(input);
    expect(again).toStrictEqual(baseline);
    // Still a digest-verified CR-001 ref whose id equals the protocol-minted
    // digest for this deployment — not merely shape-intact.
    expectRefStrictDecodes(again.deployment);
    expect(again.deployment.deployment_id).toEqual(mintRef(input).deployment_id);
  });

  it("pop/push/splice/reorder of the equivalence deployment set cannot shrink the curated set (Fractures)", () => {
    const queried = evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]);
    const baseline = detachedBaseline(queried);

    const victim = pristine(queried);
    const deployments = raw(victim).equivalence.deployments;
    deployments.pop();
    deployments.push(mintRef(evmInput(AZUKI_CHAIN_ID, AZUKI_CONTRACT)));
    deployments.splice(0, 3);
    deployments.reverse();
    deployments[0].deployment_id.digest = "0".repeat(64);
    deployments[0].network.network_reference = "corrupt";
    deployments.length = 1;

    // Same deployment again: byte-for-byte pristine.
    const again = pristine(queried);
    expect(again).toStrictEqual(baseline);

    // A DIFFERENT deployment of the same curated row sees the full set too.
    const sibling = pristine(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[7]));
    for (const hit of [again, sibling]) {
      expect(hit.equivalence.deployments).toHaveLength(FRACTURED_ADDRESSES.length);
      const keys = hit.equivalence.deployments.map(digestKeyOf);
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(keys.length);
      for (const deployment of hit.equivalence.deployments) {
        expectRefStrictDecodes(deployment);
      }
      // The assertion digest still BINDS the returned deployment set: the
      // protocol-recomputed digest over exactly these deployment_ids matches.
      if (hit.equivalence.basis.kind !== "registry") throw new Error("unreachable");
      const recomputed = Effect.runSync(
        digestVersioned(
          REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN,
          REGISTRY_EQUIVALENCE_ASSERTION_VERSION,
          {
            source: "inventory_registry",
            source_reference: "inventory-registry:fractures",
            deployment_ids: hit.equivalence.deployments.map((d) => d.deployment_id),
          }
        )
      );
      expect(hit.equivalence.basis.assertion_digest).toEqual(recomputed);
    }
  });

  it("mutating the equivalence basis and assertion_ref cannot alter the stored curated assertion", () => {
    const queried = evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[2]);
    const baseline = detachedBaseline(queried);

    const victim = pristine(queried);
    const basis = raw(victim).equivalence.basis;
    basis.kind = "single_deployment";
    basis.schema_version = 999;
    basis.assertion_digest.digest = "0".repeat(64);
    basis.assertion_digest.domain = "evil";
    delete basis.assertion_digest;
    raw(victim).equivalence.assertion_ref = "inventory-registry:evil";

    const again = pristine(queried);
    expect(again).toStrictEqual(baseline);
    expect(Either.isRight(decodeBasisStrict(again.equivalence.basis))).toBe(true);
    if (again.equivalence.basis.kind !== "registry") throw new Error("unreachable");
    if (baseline.equivalence.basis.kind !== "registry") throw new Error("unreachable");
    expect(again.equivalence.assertion_ref).toBe("inventory-registry:fractures");
    expect(again.equivalence.basis.assertion_digest).toStrictEqual(
      baseline.equivalence.basis.assertion_digest
    );
  });

  it("mutating aliases on a result reaches neither later results nor the registry itself", () => {
    const input = evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT);
    const victim = pristine(input);
    raw(victim).collection.aliases.push("evil-alias");
    raw(victim).collection.aliases[0] = "corrupt";
    raw(victim).collection.aliases.pop();

    const again = pristine(input);
    expect(again.collection.aliases).toStrictEqual(["mibera"]);

    // The live registry row and its route index are untouched — the result
    // never aliased registry-owned arrays.
    const entry = listCollectionRegistry().find((e) => e.id === MIBERA_CONTRACT)!;
    expect(entry.aliases).toStrictEqual(["mibera"]);
    expect(resolveCollectionRouteParam("mibera")?.collectionKey).toBe("mibera");
  });

  it("mutating metadata_strategy on a result reaches neither later results nor the registry strategy index", () => {
    const miberaInput = evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT);
    const mibera = pristine(miberaInput);
    raw(mibera).collection.metadata_strategy.kind = "unresolved";
    raw(mibera).collection.metadata_strategy.reason = "vandalized";

    const mstInput = evmInput(MIBERA_CHAIN_ID, MST_CONTRACT);
    const mst = pristine(mstInput);
    raw(mst).collection.metadata_strategy.slug = "vandalized";

    expect(pristine(miberaInput).collection.metadata_strategy).toStrictEqual({
      kind: "sovereign-world",
    });
    expect(pristine(mstInput).collection.metadata_strategy).toStrictEqual({
      kind: "sovereign",
      slug: "mst",
    });

    // The registry's own strategy objects (also served via the metadata
    // index) are untouched.
    expect(resolveMetadataStrategy(MIBERA_CONTRACT)).toStrictEqual({
      kind: "sovereign-world",
    });
    const mstEntry = listCollectionRegistry().find(
      (e) => e.collectionKey === "mst"
    )!;
    expect(mstEntry.metadataStrategy).toStrictEqual({ kind: "sovereign", slug: "mst" });
  });

  it("mutating or injecting image_host cannot leak across results (omit-not-null preserved)", () => {
    const pythInput = solanaInput(PYTHIANS_COLLECTION_MINT);
    const pyth = pristine(pythInput);
    raw(pyth).collection.image_host[0] = "evil.example";
    raw(pyth).collection.image_host.push("more.evil.example");
    raw(pyth).collection.image_host.pop();

    const pythAgain = pristine(pythInput);
    expect(pythAgain.collection.image_host).toStrictEqual(["ipfs.pythenians.xyz"]);

    // Injecting the key on a row that omits it must not make it appear later.
    const miberaInput = evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT);
    const mibera = pristine(miberaInput);
    raw(mibera).collection.image_host = ["injected.evil.example"];
    expect("image_host" in pristine(miberaInput).collection).toBe(false);

    // Registry row untouched.
    const pythEntry = listCollectionRegistry().find(
      (e) => e.collectionKey === "pythians"
    )!;
    expect(pythEntry.imageHost).toStrictEqual(["ipfs.pythenians.xyz"]);
  });

  it("wholesale clobbering (Object.assign, delete, reassignment) cannot corrupt the index", () => {
    const input = solanaInput(MAD_LADS_COLLECTION_MINT);
    const baseline = detachedBaseline(input);

    const victim = pristine(input);
    Object.assign(raw(victim).collection, {
      collection_key: "evil",
      enabled: false,
      total_supply: -1,
    });
    delete raw(victim).collection.name;
    raw(victim).equivalence = { basis: { kind: "evil" }, deployments: [] };
    raw(victim).deployment = null;
    raw(victim).found = false;
    raw(victim).contract_version = "evil.v9";

    expect(pristine(input)).toStrictEqual(baseline);
  });

  it("a mutation storm across every registered deployment leaves every later lookup pristine and strict-decoding", () => {
    const cases = listCollectionRegistry().flatMap((entry) =>
      rowInputs(entry).map((input) => ({
        entry,
        input,
        baseline: detachedBaseline(input),
      }))
    );

    // Storm: vandalize a freshly-served result for every deployment.
    for (const { input } of cases) {
      vandalize(pristine(input));
    }

    // Every later lookup: byte-for-byte pristine AND CR-001-verifiable.
    for (const { entry, input, baseline } of cases) {
      const hit = pristine(input);
      expect(hit).toStrictEqual(baseline);

      expectRefStrictDecodes(hit.deployment);
      for (const deployment of hit.equivalence.deployments) {
        expectRefStrictDecodes(deployment);
      }
      expect(Either.isRight(decodeBasisStrict(hit.equivalence.basis))).toBe(true);

      if (hit.equivalence.basis.kind === "registry") {
        const recomputed = Effect.runSync(
          digestVersioned(
            REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN,
            REGISTRY_EQUIVALENCE_ASSERTION_VERSION,
            {
              source: "inventory_registry",
              source_reference: `inventory-registry:${entry.collectionKey}`,
              deployment_ids: hit.equivalence.deployments.map(
                (d) => d.deployment_id
              ),
            }
          )
        );
        expect(hit.equivalence.basis.assertion_digest).toEqual(recomputed);
      }

      // The (deployments, basis) pair still passes the protocol's own
      // identity assembly after the storm.
      const identity = Effect.runSync(
        Effect.either(
          makeCollectionIdentity({
            schema_version: 1,
            deployments: hit.equivalence.deployments,
            equivalence_basis: hit.equivalence.basis,
          })
        )
      );
      expect(Either.isRight(identity)).toBe(true);
    }
  });

  it("misses are fresh values per call as well", () => {
    const input = evmInput(MIBERA_CHAIN_ID, "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01");
    const first = lookupExactDeployment(input);
    raw(first).found = true;
    raw(first).contract_version = "evil.v9";
    const second = lookupExactDeployment(input);
    expect(second).not.toBe(first);
    expect(second).toStrictEqual({
      contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION,
      found: false,
    });
  });
});
