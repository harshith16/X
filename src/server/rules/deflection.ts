/**
 * Diplomatic, human deflection phrases.
 * Redirects the conversation and changes the topic without ever confirming
 * or denying the existence of any fact or requiring robotic disclosures.
 */
const DEFLECTIONS = [
  "I'm not completely sure about that. How's everything going on your end though?",
  "I don't have those details handy right now. What have you been up to lately?",
  "I'm not certain off the top of my head! What are you working on these days?",
  "I don't have that info on hand at the moment. How have things been with you?",
  "I don't have that in front of me right now. How are things going over there?",
];

/**
 * Returns a deterministic, natural human deflection phrase.
 */
export function getDeflectionMessage(seed: string = ""): string {
  if (!seed) return DEFLECTIONS[0]!;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const index = Math.abs(hash) % DEFLECTIONS.length;
  return DEFLECTIONS[index]!;
}
