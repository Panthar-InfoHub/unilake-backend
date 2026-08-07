// will hold pronoun substitution 

import type { PronounKey } from "../../../generated/prisma/client.js";

type PronounSet = {
  subject: string;    // "he" / "she" / "they"
  object: string;     // "him" / "her" / "them"
  possessive: string; // "his" / "her" / "their"
};

const PRONOUN_TABLE: Record<PronounKey, PronounSet> = {
  HE:   { subject: "he",   object: "him",  possessive: "his" },
  SHE:  { subject: "she",  object: "her",  possessive: "her" },
  THEY: { subject: "they", object: "them", possessive: "their" },
};

export function getPronouns(key: PronounKey): PronounSet {
  return PRONOUN_TABLE[key];
}

export function substituteTokens(
  template: string,
  childName: string,
  pronounKey: PronounKey,
): string {
  const pronouns = getPronouns(pronounKey);
  return template
    .replaceAll("{name}", childName)
    .replaceAll("{pronoun_subject}", pronouns.subject)
    .replaceAll("{pronoun_object}", pronouns.object)
    .replaceAll("{pronoun_possessive}", pronouns.possessive);
}