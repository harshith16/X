import { GuardCategoryKey } from "@/types/brain";

/**
 * Validates whether a numeric string passes the Luhn algorithm checksum.
 * Used for detecting credit/debit card numbers.
 */
export function isValidLuhn(digits: string): boolean {
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 13 || clean.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// ── Category Detectors ───────────────────────────────────────────────────────

/**
 * Secrets: passwords, PINs, OTP, Luhn-valid card numbers, bank routing/IFSC, ID numbers, seed phrases, API keys.
 */
export function detectSecrets(text: string): boolean {
  // 1. Credit / Debit card check (passes Luhn)
  const candidateCards = text.match(/\b(?:\d[ -]*?){13,19}\b/g);
  if (candidateCards) {
    for (const card of candidateCards) {
      if (isValidLuhn(card)) return true;
    }
  }

  // 2. Passwords / PINs / OTPs
  if (/\b(?:my\s+)?(?:password|passcode|passwd|pwd)\s*(?:is|:|=)\s*\S+/i.test(text)) return true;
  if (/\b(?:pin|pin\s*code|pin\s*number|master\s*pin)\s*(?:is|:|=)\s*\d{4,8}\b/i.test(text)) return true;
  if (/\b(?:otp(?:\s*code)?|2fa(?:\s*code)?|verification\s*code)\s*(?:is|:|=)?\s*\d{4,8}\b/i.test(text)) return true;
  if (/\bhere\s+is\s+(?:the|my)\s+(?:secret\s+master\s+passcode|passcode|password|pin|otp)\b/i.test(text)) return true;

  // 3. Bank routing, account, IFSC
  if (/\b[A-Z]{4}0[A-Z0-9]{6}\b/.test(text)) return true; // IFSC
  if (/\b(?:routing\s*(?:number|#)?|routing)\s*(?:is|:|=)?\s*\d{9}\b/i.test(text)) return true;
  if (/\b(?:bank\s+account|account\s*(?:number|#)?)\s*(?:is|:|=)?\s*\d{8,18}\b/i.test(text)) return true;

  // 4. ID document numbers
  if (/\b\d{4}\s\d{4}\s\d{4}\b/.test(text)) return true; // Aadhaar format
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(text)) return true; // PAN card
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true; // US SSN

  // 5. Seed / mnemonic phrases
  if (/\b(?:seed\s*phrase|recovery\s*phrase|mnemonic\s*phrase)\b/i.test(text)) return true;

  // 6. API keys / tokens
  if (/\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*(?:is|:|=)\s*[A-Za-z0-9_\-.]{16,}\b/i.test(text)) return true;
  if (/\b(?:ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9_\-]{20,})\b/.test(text)) return true;

  return false;
}

/**
 * Home address: exact street address with numbers and road/street suffixes or explicit home address indicator.
 */
export function detectHomeAddress(text: string): boolean {
  if (/\b(?:my\s+)?(?:home\s+address|street\s+address|residence\s+address|residential\s+address)\s*(?:is|:|=)\s*[A-Za-z0-9\s,.-]+/i.test(text)) {
    return true;
  }
  // Standard address pattern: number + street name + suffix (Street, Avenue, Road, etc.)
  if (/\b\d{1,5}\s+[A-Za-z0-9\s,.-]+(?:Street|St\b|Avenue|Ave\b|Road|Rd\b|Boulevard|Blvd\b|Lane|Ln\b|Drive|Dr\b|Court|Ct\b|Way\b|Circle|Cir\b)/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Phone number: phone-number-shaped string (10-15 digits with standard punctuation).
 */
export function detectPhoneNumber(text: string): boolean {
  // US / international formatted: e.g. +1 (555) 123-4567, 555-123-4567, +91 9876543210
  if (/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(text)) {
    return true;
  }
  // 10-digit mobile starting with 6-9 (e.g. Indian mobile numbers or standard with prefix)
  if (/\b(?:\+?91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}\b/.test(text)) {
    return true;
  }
  // E.164 with plus and 10+ digits
  if (/\+\d{1,4}[-.\s]?\d{3,5}[-.\s]?\d{4,6}\b/.test(text)) {
    return true;
  }
  return false;
}

/**
 * Personal email: standard email address shape.
 */
export function detectPersonalEmail(text: string): boolean {
  return /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text);
}

/**
 * Live location: coordinates, map-pin links, or "I am at ... right now" phrasing.
 */
export function detectLiveLocation(text: string): boolean {
  // Coordinates e.g. 37.7749, -122.4194
  if (/\b-?\d{1,2}\.\d{3,7}\s*,\s*-?\d{1,3}\.\d{3,7}\b/.test(text)) {
    return true;
  }
  // Map pin links
  if (/(?:maps\.google\.com|goo\.gl\/maps|maps\.apple\.com|waze\.com\/ul)/i.test(text)) {
    return true;
  }
  // Phrasing: "I am at ... right now"
  if (/\b(?:i\s+am|i'm|currently)\s+(?:at|located\s+at)\s+.+\s+right\s+now\b/i.test(text)) {
    return true;
  }
  // Explicit live location phrase
  if (/\b(?:my\s+)?live\s+location\b/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Money figures: salary, balance, debt, income + an amount.
 * Bare numbers ("lunch was 400", "at 5") do NOT match.
 */
export function detectMoneyFigures(text: string): boolean {
  const contextPattern = /(?:salary|net\s*worth|bank\s*balance|account\s*balance|total\s*debt|debt|annual\s*income|monthly\s*income|earning|compensation|package|savings)/i;
  if (!contextPattern.test(text)) {
    return false;
  }

  // Must have context + a numeric figure (e.g., 2400000, 150k, $50000, 25 lakhs)
  const figurePattern = /(?:salary|net\s*worth|bank\s*balance|account\s*balance|total\s*debt|debt|annual\s*income|monthly\s*income|earning|compensation|package|savings)\s*(?:is|of|:|=)?\s*(?:[\$€£₹]|INR|USD|Rs\.?)?\s*\d[\d,.]*(?:\s*(?:k|million|m|lakh|lakhs|crore|crores))?\b/i;
  const reverseFigurePattern = /(?:[\$€£₹]|INR|USD|Rs\.?)\s*\d[\d,.]*(?:\s*(?:k|million|m|lakh|lakhs|crore|crores))?\s*(?:salary|net\s*worth|balance|debt|income|compensation|package|savings)\b/i;

  return figurePattern.test(text) || reverseFigurePattern.test(text);
}

/**
 * Health specifics: named conditions, medicines, dosages, prescriptions.
 * General talk ("doctor's appointment on Friday", "feeling unwell") does NOT match.
 */
export function detectHealthSpecifics(text: string): boolean {
  // Named serious conditions
  if (/\b(?:diabetes|cancer|hypertension|asthma|schizophrenia|bipolar|epilepsy|hiv|tuberculosis|leukemia|cardiac\s*arrest|alzheimer(?:'s)?|parkinson(?:'s)?|chemotherapy|biopsy\s*result)\b/i.test(text)) {
    return true;
  }

  // Named medicines & prescriptions / dosages
  if (/\b(?:metformin|atorvastatin|lisinopril|amoxicillin|adderall|xanax|prozac|insulin)\b/i.test(text)) {
    return true;
  }

  if (/\b(?:prescription\s+for|prescribed\s+(?:with|to|me)?|dosage\s+of|\b\d+\s*mg\s+of)\b/i.test(text)) {
    return true;
  }

  return false;
}

/**
 * Family specifics: kids' names/schools, relatives' identifying details.
 * General family talk ("his daughter's school play is Saturday") does NOT match.
 */
export function detectFamilySpecifics(text: string): boolean {
  // Kid attending named school
  if (/\b(?:daughter|son|kid|child|children)(?:'s)?\s+(?:goes\s+to|attends)\s+[A-Za-z0-9\s,.-]+/i.test(text)) {
    return true;
  }

  // School is [Name]
  if (/\b(?:school|daycare)\s+is\s+[A-Za-z0-9\s,.-]+/i.test(text)) {
    return true;
  }

  // Relatives' identifying private details
  if (/\b(?:mother's\s+maiden\s+name|father's\s+date\s+of\s+birth|relative's\s+ssn)\b/i.test(text)) {
    return true;
  }

  return false;
}

/**
 * Main detector function: evaluates outgoing text against all 8 specifics categories.
 * Returns an array of matched GuardCategoryKey values.
 */
export function detectSpecifics(text: string): GuardCategoryKey[] {
  const matches: GuardCategoryKey[] = [];

  if (detectSecrets(text)) matches.push("secrets");
  if (detectHomeAddress(text)) matches.push("home_address");
  if (detectPhoneNumber(text)) matches.push("phone_number");
  if (detectPersonalEmail(text)) matches.push("personal_email");
  if (detectLiveLocation(text)) matches.push("live_location");
  if (detectMoneyFigures(text)) matches.push("money_figures");
  if (detectHealthSpecifics(text)) matches.push("health_specifics");
  if (detectFamilySpecifics(text)) matches.push("family_specifics");

  return matches;
}
