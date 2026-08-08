/**
 * docs/SPEC.md Section 11.3's capability profile table — what a project
 * declares it needs and a pack declares it satisfies. The "Requires"
 * column in that table (e.g. "Ground and prop tilesets, 4-direction idle
 * and walk, UI skin, core SFX") is descriptive prose, not a machine
 * schema — there is no automated check anywhere yet that a pack claiming
 * a profile actually contains what that profile implies. Filtering
 * ("the editor only offers packs that satisfy the project's
 * requirements," Section 11.3) currently means matching declared ids
 * against a project's declared requirements, trusting both declarations.
 * Verifying the claim against real asset content is a real gap, not
 * silently assumed solved — tracked as follow-up work once the asset
 * resolution engine (this phase's next slice) exists to check against.
 */
export const KNOWN_CAPABILITY_PROFILES = [
  "forge/topdown-rpg-basic@1",
  "forge/topdown-rpg-combat@1",
  "forge/topdown-rpg-interior@1",
  "forge/ui-full@1",
] as const;

export type KnownCapabilityProfile = (typeof KNOWN_CAPABILITY_PROFILES)[number];

export function isKnownCapabilityProfile(id: string): id is KnownCapabilityProfile {
  return (KNOWN_CAPABILITY_PROFILES as readonly string[]).includes(id);
}
